"use strict";
/* 後台（admin console）HTTP/WS 整合測試：
   認證（未登入 401 / 偽造 cookie）、公告發佈廣播與已讀回條、指標 live/series、
   IP 統計與封鎖（驗證、踢線 4003、升級拒絕、HTTP 403、健康檢查豁免）、/admin 殼。
   測試伺服器以 opts.adminSecret/adminEmails 注入，不依賴環境與 Firestore。 */

process.env.FIRESTORE_ENABLED = "0"; // 測試絕不觸碰 Firestore

var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var WebSocket = require("ws");

var serverMod = require("../index.js");
var storeMod = require("../store.js");
var auth = require("../auth.js");
var config = require("../config.js");

var TEST_SECRET = "test-secret";
var ADMIN_EMAIL = "admin@test.dev";
var ADMIN_EMAILS = new Set([ADMIN_EMAIL]);

var nextPort = 8791;

function startServer() {
  var built = serverMod.createServer({
    store: new storeMod.InMemoryStore(),
    adminSecret: TEST_SECRET,
    adminEmails: ADMIN_EMAILS
  });
  var port = nextPort++;
  return new Promise(function (resolve) {
    built.server.listen(port, "127.0.0.1", function () {
      built.port = port;
      built.base = "http://127.0.0.1:" + port;
      built.wsUrl = "ws://127.0.0.1:" + port + "/ws";
      built.closeAll = function () {
        if (built.server.closeAllConnections) built.server.closeAllConnections();
        built.server.close();
      };
      resolve(built);
    });
  });
}

// 管理員 cookie（直接以測試金鑰簽出，跳過 Google 登入流程）
function adminCookie(email) {
  return auth.ADMIN_COOKIE + "=" + encodeURIComponent(auth.signAdminSession(email || ADMIN_EMAIL, TEST_SECRET));
}

var ADMIN_COOKIE_HEADER = { cookie: adminCookie() };

function getJson(url, headers) {
  return fetch(url, { headers: headers || {} });
}

function postJson(url, body, headers) {
  return fetch(url, {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json" }, headers || {}),
    body: JSON.stringify(body)
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error("timeout: " + label)); }, ms);
    })
  ]);
}

function openWs(wsUrl, headers) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(wsUrl, { headers: headers || {} });
    var received = [];
    var waiters = [];
    ws.on("message", function (raw) {
      var msg = JSON.parse(String(raw));
      received.push(msg);
      waiters = waiters.filter(function (w) {
        if (w.pred(msg)) { w.resolve(msg); return false; }
        return true;
      });
    });
    ws.on("open", function () { resolve(api); });
    ws.on("error", reject);
    var api = {
      ws: ws,
      received: received,
      send: function (obj) { ws.send(JSON.stringify(obj)); },
      wait: function (t, pred, timeoutMs) {
        var predFn = pred || null;
        function match(m) { return m.t === t && !m.__consumed && (!predFn || predFn(m)); }
        var existing = received.find(match);
        if (existing) { existing.__consumed = true; return Promise.resolve(existing); }
        return new Promise(function (resolve2, reject2) {
          var timer = setTimeout(function () { reject2(new Error("timeout waiting " + t)); }, timeoutMs || 3000);
          waiters.push({
            pred: function (m) {
              if (!match(m)) return false;
              m.__consumed = true;
              return true;
            },
            resolve: function (m) { clearTimeout(timer); resolve2(m); }
          });
        });
      },
      // close 事件（code/reason）
      closed: new Promise(function (resolve2) {
        ws.on("close", function (code, reason) { resolve2({ code: code, reason: String(reason) }); });
      }),
      close: function () { try { ws.close(); } catch (e) { /* 忽略 */ } }
    };
  });
}

// 嘗試 WS 連線：成功回 ws、失敗（如升級被 403 拒絕）reject
function tryConnect(wsUrl, headers) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(wsUrl, { headers: headers || {} });
    ws.on("open", function () { resolve(ws); });
    ws.on("error", reject);
  });
}

test("後台：未認證 → 401 unauthorized", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll(); });

  var res = await getJson(built.base + "/api/admin/metrics/live");
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "unauthorized");

  var res2 = await getJson(built.base + "/api/admin/announcements");
  assert.equal(res2.status, 401);
});

test("後台：以測試金鑰偽造的有效 admin cookie → 管理端點全部 200", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll(); });

  // session 檢查
  var session = await getJson(built.base + "/api/admin/session", ADMIN_COOKIE_HEADER);
  assert.equal(session.status, 200);
  var sessionBody = await session.json();
  assert.equal(sessionBody.authenticated, true);
  assert.equal(sessionBody.email, ADMIN_EMAIL);

  // metrics/live：帶 version 與 gauge 欄位
  var live = await getJson(built.base + "/api/admin/metrics/live", ADMIN_COOKIE_HEADER);
  assert.equal(live.status, 200);
  var liveBody = await live.json();
  assert.equal(liveBody.version, config.VERSION);
  assert.equal(typeof liveBody.players, "number");
  assert.equal(typeof liveBody.spectators, "number");
  assert.equal(typeof liveBody.lobby, "number");
  assert.equal(typeof liveBody.roomsPlaying, "number");

  // 公告清單
  var anns = await getJson(built.base + "/api/admin/announcements", ADMIN_COOKIE_HEADER);
  assert.equal(anns.status, 200);
  assert.deepEqual((await anns.json()).announcements, []);

  // IP 統計（預設 24h；非法 range 退回 24h）
  var stats = await getJson(built.base + "/api/admin/ip-stats", ADMIN_COOKIE_HEADER);
  assert.equal(stats.status, 200);
  var statsBody = await stats.json();
  assert.equal(statsBody.range, "24h");
  assert.ok(Array.isArray(statsBody.points));

  var stats1h = await getJson(built.base + "/api/admin/ip-stats?range=1h", ADMIN_COOKIE_HEADER);
  assert.equal((await stats1h.json()).range, "1h");
  var statsBad = await getJson(built.base + "/api/admin/ip-stats?range=bogus", ADMIN_COOKIE_HEADER);
  assert.equal((await statsBad.json()).range, "24h");

  // IP 告警與閥值
  var alerts = await getJson(built.base + "/api/admin/ip-alerts", ADMIN_COOKIE_HEADER);
  assert.equal(alerts.status, 200);
  var alertsBody = await alerts.json();
  assert.ok(Array.isArray(alertsBody.alerts));
  assert.ok(typeof alertsBody.thresholds.httpPerMin === "number");

  // 封鎖名單
  var blocks = await getJson(built.base + "/api/admin/ip-blocks", ADMIN_COOKIE_HEADER);
  assert.equal(blocks.status, 200);
  assert.deepEqual((await blocks.json()).blocks, []);
});

test("後台：admin config/google 登入端點的環境與憑證檢查", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll(); });

  var prevClientId = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  t.after(function () {
    if (prevClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevClientId;
  });

  // 未設定 GOOGLE_CLIENT_ID → clientId null；登入端點 503
  var cfg = await getJson(built.base + "/api/admin/config");
  assert.equal(cfg.status, 200);
  assert.equal((await cfg.json()).clientId, null);

  var noConfig = await postJson(built.base + "/api/admin/google", { credential: "x.y.z" });
  assert.equal(noConfig.status, 503);
  assert.equal((await noConfig.json()).error, "google-not-configured");

  // 設定 clientId 但 credential 無效 → 401 not-admin（不走 JWKS 網路）
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  var bad = await postJson(built.base + "/api/admin/google", { credential: "not-a-token" });
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error, "not-admin");

  var missing = await postJson(built.base + "/api/admin/google", {});
  assert.equal(missing.status, 400);
});

test("後台：登出清 cookie", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll(); });

  var res = await postJson(built.base + "/api/admin/logout", {});
  assert.equal(res.status, 200);
  assert.ok((res.headers.get("set-cookie") || "").indexOf("Max-Age=0") >= 0);
});

test("後台：發佈公告 → 廣播到大廳訂閱者 → 已讀回條 → 觸及人數", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll(); });

  // 大廳訂閱者
  var ws = await openWs(built.wsUrl);
  t.after(function () { ws.close(); });
  ws.send({ t: "subscribeLobby" });
  await ws.wait("lobby", null, 2000);

  // 發佈（含控制字元 → 應清洗；reached = lobby 訂閱者 1 人）
  var res = await postJson(built.base + "/api/admin/announcements",
    { text: "系統\u0007維護\n\x7f公告：今晚 23:00 例行維護" }, ADMIN_COOKIE_HEADER);
  assert.equal(res.status, 200);
  var body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.announcement.text, "系統維護公告：今晚 23:00 例行維護");
  assert.equal(body.announcement.reached, 1);
  assert.equal(body.announcement.acks, 0);
  assert.ok(body.announcement.at > 0);

  // 訂閱者應即時收到廣播
  var pushed = await ws.wait("announcement", function (m) { return m.id === body.announcement.id; }, 2000);
  assert.equal(pushed.text, body.announcement.text);
  assert.ok(pushed.at > 0);

  // 已讀回條（大廳連線 → 記為 🏠 大廳）
  ws.send({ t: "announcementAck", id: body.announcement.id });
  var listBody = null;
  for (var i = 0; i < 20; i++) {
    var listRes = await getJson(built.base + "/api/admin/announcements", ADMIN_COOKIE_HEADER);
    listBody = await listRes.json();
    if (listBody.announcements[0] && listBody.announcements[0].acks >= 1) break;
    await sleep(100);
  }
  assert.ok(listBody.announcements[0].acks >= 1, "公告應記錄已讀回條");
  assert.equal(listBody.announcements[0].id, body.announcement.id);
  assert.equal(listBody.announcements[0].reached, 1);

  // 新訂閱者：subscribeLobby 應先收到當前生效公告，再收 lobby 名單
  var ws2 = await openWs(built.wsUrl);
  t.after(function () { ws2.close(); });
  ws2.send({ t: "subscribeLobby" });
  var replay = await ws2.wait("announcement", function (m) { return m.id === body.announcement.id; }, 2000);
  assert.equal(replay.text, body.announcement.text);
  await ws2.wait("lobby", null, 2000);
  assert.equal(ws2.received[0].t, "announcement", "生效公告應先於 lobby 名單");

  // 空內容 → 400
  var empty = await postJson(built.base + "/api/admin/announcements", { text: "   " }, ADMIN_COOKIE_HEADER);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, "empty-text");
});

test("後台：metrics series — day/minute/預設值與非法 granularity 400", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll(); });

  var day = await getJson(built.base + "/api/admin/metrics/series?granularity=day", ADMIN_COOKIE_HEADER);
  assert.equal(day.status, 200);
  var dayBody = await day.json();
  assert.equal(dayBody.granularity, "day");
  assert.ok(Array.isArray(dayBody.points));

  var hour = await getJson(built.base + "/api/admin/metrics/series?granularity=hour", ADMIN_COOKIE_HEADER);
  assert.equal(hour.status, 200);
  assert.equal((await hour.json()).granularity, "hour");

  var def = await getJson(built.base + "/api/admin/metrics/series", ADMIN_COOKIE_HEADER);
  assert.equal((await def.json()).granularity, "minute");

  var bad = await getJson(built.base + "/api/admin/metrics/series?granularity=week", ADMIN_COOKIE_HEADER);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "bad-granularity");
});

test("後台：IP 封鎖 — 參數驗證、踢線 4003、新連線拒絕、HTTP 403、健康檢查豁免、解除", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll(); });

  // 參數驗證
  var badIp = await postJson(built.base + "/api/admin/ip-blocks", { ip: "not-an-ip", duration: "5m" }, ADMIN_COOKIE_HEADER);
  assert.equal(badIp.status, 400);
  assert.equal((await badIp.json()).error, "bad-ip");

  var badDuration = await postJson(built.base + "/api/admin/ip-blocks", { ip: "203.0.113.9", duration: "3h" }, ADMIN_COOKIE_HEADER);
  assert.equal(badDuration.status, 400);
  assert.equal((await badDuration.json()).error, "bad-duration");

  // 既有連線：以 X-Forwarded-For 假造來源 IP（trust proxy）
  var ws = await openWs(built.wsUrl, { "x-forwarded-for": "203.0.113.9" });
  t.after(function () { ws.close(); });
  ws.send({ t: "subscribeLobby" });
  await ws.wait("lobby", null, 2000);

  // 封鎖該 IP → 既有 WS 連線應立即被踢（close code 4003 'ip-blocked'）
  var res = await postJson(built.base + "/api/admin/ip-blocks", { ip: "203.0.113.9", duration: "5m" }, ADMIN_COOKIE_HEADER);
  assert.equal(res.status, 200);
  var body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.block.ip, "203.0.113.9");
  assert.equal(body.block.blockedBy, ADMIN_EMAIL);
  var closed = await withTimeout(ws.closed, 2000, "被踢線（4003）");
  assert.equal(closed.code, 4003);
  assert.equal(closed.reason, "ip-blocked");

  // 封鎖名單應列出
  var blocksRes = await getJson(built.base + "/api/admin/ip-blocks", ADMIN_COOKIE_HEADER);
  var blocks = (await blocksRes.json()).blocks;
  assert.ok(blocks.some(function (b) { return b.ip === "203.0.113.9"; }));

  // 封鎖中的 IP：新 WS 升級被 403 拒絕
  await assert.rejects(tryConnect(built.wsUrl, { "x-forwarded-for": "203.0.113.9" }), /403/);

  // HTTP：非豁免路徑 → 403 ip-blocked；健康檢查豁免 → 200
  var blocked = await getJson(built.base + "/api/games", { "x-forwarded-for": "203.0.113.9" });
  assert.equal(blocked.status, 403);
  var blockedBody = await blocked.json();
  assert.equal(blockedBody.error, "ip-blocked");
  assert.ok(blockedBody.message.indexOf("封鎖") >= 0);

  var health = await getJson(built.base + "/api/health", { "x-forwarded-for": "203.0.113.9" });
  assert.equal(health.status, 200);
  var healthz = await getJson(built.base + "/api/healthz", { "x-forwarded-for": "203.0.113.9" });
  assert.equal(healthz.status, 200);

  // 解除封鎖 → 恢復正常
  var del = await fetch(built.base + "/api/admin/ip-blocks/" + encodeURIComponent("203.0.113.9"),
    { method: "DELETE", headers: ADMIN_COOKIE_HEADER });
  assert.equal(del.status, 200);
  var delBody = await del.json();
  assert.equal(delBody.ok, true);
  assert.equal(delBody.removed, true);

  var after = await getJson(built.base + "/api/games", { "x-forwarded-for": "203.0.113.9" });
  assert.equal(after.status, 200);

  // 重複 DELETE → removed false
  var delAgain = await fetch(built.base + "/api/admin/ip-blocks/" + encodeURIComponent("203.0.113.9"),
    { method: "DELETE", headers: ADMIN_COOKIE_HEADER });
  assert.equal((await delAgain.json()).removed, false);
});

test("後台：IP 監控記錄 HTTP/WS 流量（ip-stats 可見）", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll(); });

  await getJson(built.base + "/api/games", { "x-forwarded-for": "198.51.100.7" });
  var ws = await openWs(built.wsUrl, { "x-forwarded-for": "198.51.100.7" });
  t.after(function () { ws.close(); });
  ws.send({ t: "subscribeLobby" });
  await ws.wait("lobby", null, 2000);

  var res = await getJson(built.base + "/api/admin/ip-stats?range=1h", ADMIN_COOKIE_HEADER);
  var points = (await res.json()).points;
  var row = points.find(function (p) { return p.ip === "198.51.100.7"; });
  assert.ok(row, "ip-stats 應包含該 IP");
  assert.ok(row.http >= 1, "HTTP 計數");
  assert.ok(row.connEvents >= 1, "WS 連線事件計數");
  assert.equal(row.concurrent, 1, "目前並連數");
});

test("後台：/admin 回後台殼（不存在時 404）", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll(); });

  var adminHtmlPath = path.join(__dirname, "..", "..", "admin.html");
  var res = await getJson(built.base + "/admin");
  if (fs.existsSync(adminHtmlPath)) {
    assert.equal(res.status, 200);
    assert.ok((res.headers.get("content-type") || "").indexOf("text/html") >= 0);
  } else {
    // admin.html 尚未由平行流程產出：應優雅回 404
    assert.equal(res.status, 404);
  }
});