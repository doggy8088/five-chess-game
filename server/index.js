"use strict";
/* WS 入口 + HTTP API：靜態檔、/api/healthz、/api/health、/api/games、POST /api/rooms、
   /r/:roomId、/online 與 /game SPA 路由、/admin 後台殼、後台管理 API（登入/公告/指標/IP 監控封鎖）、
   /ws upgrade（含 IP 封鎖拒絕與既有連線踢除）、30s 心跳、大廳訂閱推播。
   後台相關環境變數：
   - GOOGLE_CLIENT_ID：OAuth client id（/api/admin/config 公開；登入驗證 audience 必填）。
   - ADMIN_EMAILS：管理員 email allowlist（逗號分隔，詳見 auth.js）。
   - ADMIN_SESSION_SECRET：session cookie HMAC 金鑰；未設時隨機產生（重啟即全員登出）。
   - IP_ALERT_HTTP_PER_MIN / IP_ALERT_WS_PER_MIN / IP_ALERT_CONN_PER_MIN /
     IP_ALERT_HTTP_PER_HOUR：IP 異常告警閥值（詳見 ip-monitor.js）。 */

var path = require("path");
var http = require("http");
var fs = require("fs");
var crypto = require("crypto");
var express = require("express");
var WebSocket = require("ws");

var config = require("./config.js");
var Protocol = require("../shared/protocol.js");
var guards = require("./guards.js");
var ids = require("./ids.js");
var roomMod = require("./room.js");
var storeMod = require("./store.js");
var roomsMod = require("./rooms.js");
var authMod = require("./auth.js");
var announcementsMod = require("./announcements.js");
var metricsMod = require("./metrics.js");
var ipMonitorMod = require("./ip-monitor.js");

// 封鎖檢查豁免路徑：後台自身與健康檢查，管理員不會把自己鎖在外面。
var IP_BLOCK_EXEMPT_RE = /^\/(admin|api\/admin|healthz|api\/health)/;

// /api/admin/ip-stats 的查詢窗格
var IP_STATS_RANGES = { "1h": 3600000, "24h": 86400000, "7d": 604800000 };

// 真實 client IP：X-Forwarded-For 第一跳（trust proxy 下 req.ip 同源）→ socket 位址。
function clientIp(req) {
  var forwarded = req.headers["x-forwarded-for"];
  var first = typeof forwarded === "string"
    ? forwarded.split(",")[0].trim()
    : (Array.isArray(forwarded) ? String(forwarded[0]).trim() : undefined);
  return first || req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

function createServer(opts) {
  opts = opts || {};
  var app = express();
  var rootDir = path.join(__dirname, "..");

  // Cloud Run 在 Google Front End 終結 TLS，真實 client IP 在 X-Forwarded-For；
  // trust proxy 讓 req.ip 解析到它（clientIp 亦優先讀該 header）。
  app.set("trust proxy", true);

  // ---- 後台（admin console）----
  // adminSecret/adminEmails/adminStore 可由 opts 注入（測試用）；未注入時退回環境變數。
  var adminSecret = opts.adminSecret || process.env.ADMIN_SESSION_SECRET || authMod.randomSecret();
  var adminEmails = opts.adminEmails || authMod.adminEmailsFromEnv();
  // 後台資料持久化（公告歷史、指標小時彙總、IP 流量/封鎖/告警）：由程式進入點在
  // FIRESTORE_ENABLED 時動態載入 FirestoreAdminStore 後注入（與 rooms store 同模式），
  // createServer 本身不建立網路連線，測試不依賴 Firestore。
  var adminStore = opts.adminStore || null;

  var announcements = new announcementsMod.AnnouncementBoard(adminStore);
  announcements.init(); // best-effort 還原公告歷史（內部自行補捉錯誤）

  var ipMonitor = new ipMonitorMod.IpMonitor(adminStore);
  ipMonitor.init();     // best-effort 還原封鎖名單與警示
  ipMonitor.start();

  // ---- HTTP ----
  var indexCache = null;

  // 依「內容雜湊」注入資產版本：index.html 中 ?v=__ASSET_VER__ 於請求時
  // 以檔案 sha1 前 8 碼取代；檔案內容改變 → URL 改變 → 瀏覽器自動抓新版。
  function assetVersion(relPath) {
    try {
      var buf = fs.readFileSync(path.join(rootDir, relPath));
      return crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8);
    } catch (e) {
      return config.VERSION; // 檔案不存在時退回套件版號
    }
  }

  // 套用 ?v=__ASSET_VER__ 資產版本注入（index.html 與 admin.html 共用）。
  function getVersionedHtml(relPath) {
    var html = fs.readFileSync(path.join(rootDir, relPath), "utf8");
    return html.replace(/(src|href)="([^"?]+)\?v=__ASSET_VER__/g, function (m, attr, p) {
      return attr + '="' + p + "?v=" + assetVersion(p);
    });
  }

  function getIndexHtml() {
    return getVersionedHtml("index.html");
  }

  // ---- 全域中介層（所有路由之前）：負載指標 + IP 流量記錄 + 封鎖檢查 ----
  app.use(function (req, res, next) {
    metrics.recordHttp();
    var ip = clientIp(req);
    ipMonitor.recordHttp(ip);
    // 封鎖不影響後台自身與健康檢查，管理員不會把自己鎖在外面。
    if (!IP_BLOCK_EXEMPT_RE.test(req.path) && ipMonitor.isBlocked(ip)) {
      res.status(403).json({ error: "ip-blocked", message: "您的網路位置已被暫時封鎖。若有疑問請與管理員聯絡。" });
      return;
    }
    next();
  });

  app.get("/", function (req, res) {
    res.type("html").set("Cache-Control", "no-cache").send(getIndexHtml());
  });
  app.get("/api/healthz", function (req, res) { res.type("text/plain").send("ok"); }); // /healthz 被 Google Frontend 保留，改用 /api/healthz
  app.get("/api/health", function (req, res) { res.json({ ok: true, version: config.VERSION }); });

  app.get("/api/games", function (req, res) {
    manager.listGames(Protocol.LOBBY_HTTP_LIMIT).then(function (games) {
      res.json({ games: games });
    }).catch(function (err) {
      console.error("[api] /api/games failed", err && err.message);
      res.json({ games: [] });
    });
  });

  app.use(express.json({ limit: "16kb" }));

  // -------------------------------------------------------- 後台管理 API

  // 從 cookie 驗 admin session；有效回傳 email，否則 null。
  function currentAdminEmail(req) {
    var token = authMod.parseCookies(req.headers.cookie)[authMod.ADMIN_COOKIE];
    if (!token) return null;
    var session = authMod.verifyAdminSession(token, adminSecret);
    if (!session || !authMod.isAdminEmail(session.email, adminEmails)) return null;
    return session.email;
  }

  // 後台 API 關卡：無效 session → 401；有效 → res.locals.adminEmail。
  function requireAdmin(req, res, next) {
    var email = currentAdminEmail(req);
    if (!email) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.locals.adminEmail = email;
    next();
  }

  // Google 登入按鈕用的 OAuth client id（公開資訊）。
  app.get("/api/admin/config", function (req, res) {
    res.json({ clientId: process.env.GOOGLE_CLIENT_ID ?? null });
  });

  // Google Identity Services ID token 登入：驗簽 → allowlist → 簽發 HttpOnly cookie。
  app.post("/api/admin/google", async function (req, res) {
    try {
      var clientId = process.env.GOOGLE_CLIENT_ID;
      var credential = req.body && typeof req.body.credential === "string" ? req.body.credential : "";
      if (!clientId) {
        res.status(503).json({ error: "google-not-configured", message: "伺服器尚未設定 GOOGLE_CLIENT_ID" });
        return;
      }
      if (!credential) {
        res.status(400).json({ error: "missing-credential" });
        return;
      }
      var identity = await authMod.verifyGoogleIdToken(credential, clientId);
      if (!identity || !authMod.isAdminEmail(identity.email, adminEmails)) {
        res.status(401).json({ error: "not-admin", message: "此 Google 帳號沒有管理員權限" });
        return;
      }
      res.setHeader("Set-Cookie", authMod.adminCookieHeader(authMod.signAdminSession(identity.email, adminSecret, authMod.ADMIN_SESSION_TTL_MS)));
      res.json({ ok: true, email: identity.email });
    } catch (error) {
      console.error("[admin] google auth failed", error && error.message);
      res.status(500).json({ error: "auth-failed" });
    }
  });

  app.get("/api/admin/session", function (req, res) {
    var email = currentAdminEmail(req);
    res.json({ authenticated: email !== null, email: email });
  });

  app.post("/api/admin/logout", function (req, res) {
    res.setHeader("Set-Cookie", authMod.clearAdminCookieHeader());
    res.json({ ok: true });
  });

  // 發佈全站公告：清洗（剝控制字元 → trim → 500 字）→ 記錄觸及人數 →
  // 廣播到每個房間（玩家 + 觀眾）與每個大廳訂閱者。
  app.post("/api/admin/announcements", requireAdmin, function (req, res) {
    var raw = req.body && typeof req.body.text === "string" ? req.body.text : "";
    var text = Array.from(raw)
      .filter(function (ch) {
        var code = ch.codePointAt(0) || 0;
        return code >= 32 && code !== 127;
      })
      .join("")
      .trim()
      .slice(0, 500);
    if (!text) {
      res.status(400).json({ error: "empty-text", message: "公告內容不可為空" });
      return;
    }
    var stats = manager.stats();
    var reached = stats.players + stats.spectators + manager.lobbySubscribers.size;
    var record = announcements.post(text, reached);
    var message = { t: "announcement", id: record.id, text: record.text, at: record.at };
    manager.announce(message);
    manager.lobbySubscribers.forEach(function (_v, socketId) {
      manager.transport.send(socketId, message);
    });
    res.json({ ok: true, announcement: { id: record.id, text: record.text, at: record.at, reached: reached, acks: 0 } });
  });

  app.get("/api/admin/announcements", requireAdmin, function (req, res) {
    res.json({ announcements: announcements.list() });
  });

  app.get("/api/admin/metrics/live", requireAdmin, function (req, res) {
    res.json(Object.assign({ version: config.VERSION }, metrics.live()));
  });

  // 指標時間序列：granularity=minute|hour|day（未帶預設 minute；帶了不合法 → 400）。
  app.get("/api/admin/metrics/series", requireAdmin, async function (req, res) {
    var raw = req.query.granularity;
    if (raw !== undefined && raw !== "minute" && raw !== "hour" && raw !== "day") {
      res.status(400).json({ error: "bad-granularity", message: "granularity 必須是 minute / hour / day" });
      return;
    }
    var granularity = raw || "minute";
    var to = Number(req.query.to) || Date.now();
    var from = Number(req.query.from) || to - 3600000;
    try {
      if (granularity === "minute") {
        res.json({ granularity: granularity, points: metrics.seriesMinute(from, to) });
        return;
      }
      if (granularity === "hour") {
        res.json({ granularity: granularity, points: await metrics.seriesHour(from, to) });
        return;
      }
      res.json({ granularity: granularity, points: await metrics.seriesDay(from, to) });
    } catch (error) {
      console.error("[admin] metrics series failed", error && error.message);
      res.status(500).json({ error: "metrics-failed" });
    }
  });

  // -------------------------------------------------- IP 監控與封鎖

  app.get("/api/admin/ip-stats", requireAdmin, function (req, res) {
    var range = typeof req.query.range === "string" && Object.prototype.hasOwnProperty.call(IP_STATS_RANGES, req.query.range)
      ? req.query.range
      : "24h";
    res.json({ range: range, points: ipMonitor.top(IP_STATS_RANGES[range]) });
  });

  app.get("/api/admin/ip-alerts", requireAdmin, function (req, res) {
    res.json({ alerts: ipMonitor.listAlerts(), thresholds: ipMonitor.thresholds() });
  });

  app.get("/api/admin/ip-blocks", requireAdmin, function (req, res) {
    res.json({ blocks: ipMonitor.listBlocks() });
  });

  app.post("/api/admin/ip-blocks", requireAdmin, function (req, res) {
    var ip = req.body && typeof req.body.ip === "string" ? req.body.ip.trim() : "";
    var duration = req.body ? req.body.duration : undefined;
    if (!ip || ip.length > 45 || !ipMonitorMod.looksLikeIp(ip)) {
      res.status(400).json({ error: "bad-ip", message: "IP 格式不正確（需為 IPv4 或 IPv6）" });
      return;
    }
    if (!ipMonitorMod.isIpBlockDuration(duration)) {
      res.status(400).json({
        error: "bad-duration",
        message: "時長必須是：" + Object.keys(ipMonitorMod.IP_BLOCK_DURATIONS).join(" / ") + " / permanent"
      });
      return;
    }
    var block = ipMonitor.block(ip, duration, res.locals.adminEmail);
    // 立即中斷該 IP 的既有連線（升級時的檢查只擋新連線）。
    sockets.forEach(function (client) {
      if (client.ip === ip) {
        try { client.close(4003, "ip-blocked"); } catch (e) { /* 忽略 */ }
      }
    });
    res.json({ ok: true, block: block });
  });

  app.delete("/api/admin/ip-blocks/:ip", requireAdmin, function (req, res) {
    var removed = ipMonitor.unblock(req.params.ip || "");
    res.json({ ok: true, removed: removed });
  });

  app.post("/api/rooms", function (req, res) {
    var body = req.body || {};
    var name = typeof body.name === "string" ? body.name.slice(0, Protocol.LIMITS.joinName) : "";
    var ruleset = Protocol.normalizeRuleset(body.ruleset);
    var room = manager.createRoom(name, ruleset);
    res.status(201).json({
      roomId: room.roomId,
      playerToken: room.seats[0].token,
      ruleset: room.ruleset
    });
  });

  // /r/:roomId → SPA shell（client 從路由解析 roomId）
  app.get("/r/:roomId", function (req, res) {
    res.type("html").set("Cache-Control", "no-cache").send(getIndexHtml());
  });

  // /online → 線上對戰大廳 SPA shell（client 從路由解析畫面；深連結／重新整理可用）
  app.get("/online", function (req, res) {
    res.type("html").set("Cache-Control", "no-cache").send(getIndexHtml());
  });

  // /game → 本地遊戲 SPA shell（client 從路由解析畫面；深連結／重新整理可用）
  app.get("/game", function (req, res) {
    res.type("html").set("Cache-Control", "no-cache").send(getIndexHtml());
  });

  // 後台殼（登入在前端以 Google Identity Services 完成）。
  // admin.html 由平行流程產出；尚未存在時優雅回 404。
  app.get("/admin", function (req, res) {
    var adminHtml = path.join(rootDir, "admin.html");
    fs.stat(adminHtml, function (err) {
      if (err) {
        res.status(404).json({ error: "admin-ui-missing", message: "後台頁面尚未部署" });
        return;
      }
      // 與首頁相同：請求時注入資產內容雜湊版本（?v=<sha1-8>）
      res.type("html").set("Cache-Control", "no-cache").send(getVersionedHtml("admin.html"));
    });
  });

  // 靜態檔：HTML 不快取（避免部署後拿到舊殼）；帶 ?v= 內容雜湊的資產長快取
  app.use(express.static(rootDir, {
    index: false,
    setHeaders: function (res, filePath) {
      if (filePath.endsWith(".html")) { res.setHeader("Cache-Control", "no-cache"); return; }
      var req = res.req;
      if (req && req.query && req.query.v) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      else res.setHeader("Cache-Control", "public, max-age=3600");
    }
  }));

  // ---- WS ----
  var server = http.createServer(app);
  // 升級手動處理（noServer）：路徑檢查 → 封鎖中的 IP 直接拒絕升級 → 交給 ws。
  var wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", function (request, socket, head) {
    var pathname = "/";
    try { pathname = new URL(request.url || "/", "http://localhost").pathname; } catch (e) {
      socket.destroy();
      return;
    }
    if (pathname !== "/ws") { socket.destroy(); return; }
    var ip = clientIp(request);
    // 封鎖中的 IP：直接拒絕 WebSocket 升級。
    if (ipMonitor.isBlocked(ip)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, function (ws) {
      // 每條連線的用戶端 IP（升級時記錄），封鎖時用來踢線。
      ws.ip = ip;
      wss.emit("connection", ws, request);
    });
  });

  var sockets = new Map(); // socketId -> ws
  var nextSocketId = 1;
  var manager = opts.manager || null;

  var transport = {
    send: function (socketId, payload) {
      var ws = sockets.get(socketId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(payload)); } catch (e) { /* 忽略 */ }
      }
    },
    close: function (socketId, code, reason) {
      var ws = sockets.get(socketId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.close(code, reason); } catch (e) { /* 忽略 */ }
      }
    }
  };

  // RoomManager hooks：公告已讀回條 + 新 lobby 訂閱者先收當前生效公告。
  var managerHooks = {
    onAnnouncementAck: function (id, name) { announcements.ack(id, name); },
    activeAnnouncement: function () {
      var current = announcements.current();
      return current ? { id: current.id, text: current.text, at: current.at } : null;
    }
  };

  if (!manager) {
    var store = opts.store || new storeMod.InMemoryStore();
    manager = new roomsMod.RoomManager(store, transport, managerHooks);
  }
  manager.startSweepTimer();

  // 負載指標：gauge 取房間統計 + 大廳訂閱數；小時彙總經 adminStore 落地。
  var metrics = new metricsMod.Metrics({
    gauge: function () {
      var stats = manager.stats();
      return {
        players: stats.players,
        spectators: stats.spectators,
        roomsPlaying: stats.roomsPlaying,
        roomsWaiting: stats.roomsWaiting,
        lobby: manager.lobbySubscribers.size
      };
    },
    persistence: adminStore
  });
  metrics.start();

  wss.on("connection", function (ws) {
    var socketId = "s" + (nextSocketId++);
    var ip = typeof ws.ip === "string" ? ws.ip : "unknown";
    ws.isAlive = true;
    ws.socketId = socketId;
    ws.roomId = null;
    ws.seat = null;
    sockets.set(socketId, ws);
    ipMonitor.recordWsConnect(ip);

    // 升級後、連線事件前才被封鎖的競態：連線當下立即斷線。
    if (ipMonitor.isBlocked(ip)) {
      try { ws.close(4003, "ip-blocked"); } catch (e) { /* 忽略 */ }
    }

    ws.on("pong", function () { ws.isAlive = true; });

    ws.on("message", function (raw) {
      metrics.recordWsMessage();
      ipMonitor.recordWsMessage(ip);
      var msg;
      try { msg = JSON.parse(String(raw)); } catch (e) { msg = null; }
      var guarded = guards.guardMessage(msg);
      if (!guarded) {
        transport.send(socketId, { t: "error", code: "bad-message", message: "無效的訊息格式" });
        return;
      }
      handleMessage(ws, guarded).catch(function (err) {
        console.error("[ws] handleMessage failed", guarded.t, err && err.message);
        transport.send(socketId, { t: "error", code: "bad-message", message: "伺服器處理訊息失敗" });
      });
    });

    ws.on("close", function () {
      sockets.delete(socketId);
      manager.unsubscribeLobby(socketId);
      ipMonitor.recordWsDisconnect(ip);
      if (ws.roomId) {
        manager.get(ws.roomId).then(function (room) {
          if (room) { room.disconnect(socketId); manager.persist(room); }
        }).catch(function () { });
        ws.roomId = null;
        ws.seat = null;
      }
    });

    ws.on("error", function () { /* close 會接手 */ });
  });

  function currentRoom(ws) {
    if (!ws.roomId) return Promise.resolve(null);
    return manager.get(ws.roomId);
  }

  async function handleMessage(ws, msg) {
    var socketId = ws.socketId;

    switch (msg.t) {
      case "subscribeLobby": {
        manager.subscribeLobby(socketId);
        var games = await manager.listGames(Protocol.LOBBY_PUSH_LIMIT);
        transport.send(socketId, { t: "lobby", games: games });
        return;
      }

      case "announcementAck": {
        // 公告已讀回條：房內記坐席/觀眾名稱；僅在大廳的連線記為 🏠 大廳。
        var ackName = "🏠 大廳";
        var ackRoom = await currentRoom(ws);
        if (ackRoom) {
          if (ws.seat === 0 || ws.seat === 1) {
            ackName = ackRoom.seatName(ws.seat) || ackName;
          } else {
            var spectator = ackRoom.spectators.get(socketId);
            if (spectator && spectator.name) ackName = spectator.name;
          }
        }
        if (manager.hooks && typeof manager.hooks.onAnnouncementAck === "function") {
          manager.hooks.onAnnouncementAck(msg.id, ackName);
        }
        return;
      }

      case "join": {
        // 換房：先離開舊房
        if (ws.roomId && ws.roomId !== msg.roomId) {
          var oldRoom = await manager.get(ws.roomId);
          if (oldRoom) { oldRoom.disconnect(socketId); manager.persist(oldRoom); }
          ws.roomId = null;
          ws.seat = null;
        }
        var room = await manager.get(msg.roomId);
        if (!room) {
          transport.send(socketId, { t: "error", code: "room-not-found", message: "找不到對局" });
          return;
        }
        var payload = room.join(socketId, msg);
        ws.roomId = room.roomId;
        ws.seat = payload.seat;
        manager.persist(room);
        return;
      }

      case "action": {
        var room2 = await currentRoom(ws);
        if (!room2) { transport.send(socketId, { t: "error", code: "room-not-found", message: "找不到對局" }); return; }
        room2.handleAction(socketId, ws.seat, msg);
        manager.persist(room2);
        return;
      }

      case "chat": {
        var room3 = await currentRoom(ws);
        if (!room3) return;
        room3.handleChat(socketId, ws.seat, msg);
        manager.persist(room3);
        return;
      }

      case "canned": {
        var room4 = await currentRoom(ws);
        if (!room4) return;
        room4.handleCanned(socketId, ws.seat, msg);
        manager.persist(room4);
        return;
      }

      case "drawOffer": { var r = await currentRoom(ws); if (r) { r.offerDraw(socketId, ws.seat); manager.persist(r); } return; }
      case "drawResponse": { var r2 = await currentRoom(ws); if (r2) { r2.respondDraw(socketId, ws.seat, msg.accept); manager.persist(r2); } return; }
      case "abortRequest": { var r3 = await currentRoom(ws); if (r3) { r3.requestAbort(socketId, ws.seat); manager.persist(r3); } return; }
      case "abortResponse": { var r4 = await currentRoom(ws); if (r4) { r4.respondAbort(socketId, ws.seat, msg.accept); manager.persist(r4); } return; }
      case "resign": { var r5 = await currentRoom(ws); if (r5) { r5.resign(socketId, ws.seat); manager.persist(r5); } return; }
      case "rematch": { var r6 = await currentRoom(ws); if (r6) { r6.offerRematch(socketId, ws.seat); manager.persist(r6); } return; }
      case "rematchResponse": { var r7 = await currentRoom(ws); if (r7) { r7.respondRematch(socketId, ws.seat, msg.accept); manager.persist(r7); } return; }

      default:
        transport.send(socketId, { t: "error", code: "bad-message", message: "無效的訊息格式" });
    }
  }

  // 心跳：30s ping，沒 pong 就 terminate（Cloud Run/代理會砍靜默連線）
  var heartbeat = setInterval(function () {
    wss.clients.forEach(function (ws) {
      if (!ws.isAlive) { try { ws.terminate(); } catch (e) { /* 忽略 */ } return; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* 忽略 */ }
    });
  }, config.HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();

  return {
    app: app, server: server, wss: wss, manager: manager, transport: transport,
    announcements: announcements, ipMonitor: ipMonitor, metrics: metrics
  };
}

if (require.main === module) {
  var store;
  if (config.FIRESTORE_ENABLED) {
    try {
      var FirestoreStore = require("./firestore-store.js").FirestoreStore;
      store = new FirestoreStore({ collection: config.FIRESTORE_COLLECTION, clientOptions: { projectId: config.GCLOUD_PROJECT } });
      console.log("[server] 持久化：Firestore（collection=%s）", config.FIRESTORE_COLLECTION);
    } catch (err) {
      console.error("[server] Firestore 初始化失敗，退回 InMemoryStore：", err && err.message);
      store = new storeMod.InMemoryStore();
    }
  } else {
    store = new storeMod.InMemoryStore();
    console.log("[server] 持久化：InMemoryStore");
  }

  // 後台資料持久化（公告歷史、指標小時彙總、IP 封鎖/告警）：FIRESTORE_ENABLED 時
  // 動態載入 FirestoreAdminStore（dark-chess 同款），失敗則後台資料僅存記憶體。
  var adminStore = null;
  if (config.FIRESTORE_ENABLED) {
    try {
      var FirestoreAdminStore = require("./firestore-admin.js").FirestoreAdminStore;
      adminStore = new FirestoreAdminStore({ clientOptions: { projectId: config.GCLOUD_PROJECT } });
      console.log("[server] 後台資料持久化：Firestore（announcements/metrics_hours/ip_*）");
    } catch (err) {
      console.error("[server] FirestoreAdminStore 初始化失敗，後台資料僅存記憶體：", err && err.message);
      adminStore = null;
    }
  }

  var built = createServer({ store: store, adminStore: adminStore });
  var port = config.PORT;
  built.server.listen(port, function () {
    console.log("[server] 五子棋線上對戰伺服器已啟動：http://localhost:%d（v%s）", port, config.VERSION);
  });
}

module.exports = { createServer: createServer };