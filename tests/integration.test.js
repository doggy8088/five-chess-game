"use strict";
/* 端到端整合測試：真實 HTTP + WS 伺服器，跑完整對局流程。 */

var test = require("node:test");
var assert = require("node:assert");
var WebSocket = require("ws");
var http = require("http");

var serverMod = require("../server/index.js");
var storeMod = require("../server/store.js");


var nextPort = 8781;

function startServer() {
  var built = serverMod.createServer({ store: new storeMod.InMemoryStore() });
  var port = nextPort++;
  return new Promise(function (resolve) {
    built.server.listen(port, function () {
      // 測試結束時強制關閉所有連線（含 WS keep-alive），避免影響下一個測試
      built.closeAll = function () {
        if (built.server.closeAllConnections) built.server.closeAllConnections();
        built.server.close();
      };
      built.port = port;
      built.base = "http://127.0.0.1:" + port;
      built.wsUrl = "ws://127.0.0.1:" + port + "/ws";
      resolve(built);
    });
  });
}

function openWs(wsUrl) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(wsUrl);
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
      // 等到某 t 類型（可加 predicate）訊息；已消費的訊息不會重複匹配（保證時序）
      wait: function (t, pred, timeoutMs) {
        var predFn = pred || null;
        function match(m) {
          return m.t === t && !m.__consumed && (!predFn || predFn(m));
        }
        var existing = received.find(match);
        if (existing) { existing.__consumed = true; return Promise.resolve(existing); }
        return new Promise(function (resolve, reject) {
          var timer = setTimeout(function () { reject(new Error("timeout waiting " + t)); }, timeoutMs || 3000);
          waiters.push({
            pred: function (m) {
              if (!match(m)) return false;
              m.__consumed = true;
              return true;
            },
            resolve: function (m) { clearTimeout(timer); resolve(m); }
          });
        });
      },
      close: function () { try { ws.close(); } catch (e) { } }
    };
  });
}

async function createRoom(built, name, ruleset) {
  var res = await fetch(built.base + "/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: name, ruleset: ruleset })
  });
  assert.equal(res.status, 201);
  return res.json();
}

test("整合：建立 → 加入 → 對弈 → 五連勝負 → 再來一局換先手", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll ? built.closeAll() : built.server.close(); });

  var room = await createRoom(built, "阿黑", "standard");
  assert.ok(/^[a-z2-9]{10}$/.test(room.roomId));
  assert.ok(/^[0-9a-f]{32}$/.test(room.playerToken));

  var ws0 = await openWs(built.wsUrl);
  var ws1 = await openWs(built.wsUrl);
  var ws2 = await openWs(built.wsUrl); // 觀眾
  t.after(function () { ws0.ws.close(); ws1.ws.close(); ws2.ws.close(); });

  // 建立者 join → waiting
  ws0.send({ t: "join", roomId: room.roomId, playerToken: room.playerToken, name: "阿黑" });
  var j0 = await ws0.wait("joined");
  assert.equal(j0.seat, 0);
  assert.equal(j0.roomStatus, "waiting");

  // 觀戰意圖不占座
  ws2.send({ t: "join", roomId: room.roomId, name: "路人", spectate: true });
  var j2 = await ws2.wait("joined");
  assert.equal(j2.seat, null);

  // 對手加入 → playing，雙方收到 state
  ws1.send({ t: "join", roomId: room.roomId, name: "阿白" });
  var j1 = await ws1.wait("joined");
  assert.equal(j1.seat, 1);
  assert.equal(j1.roomStatus, "playing");
  await ws0.wait("state", null, 1000).catch(function () { }); // state 廣播（可能早於 joined 送達）

  // 黑棋（seat 0）落子
  ws0.send({ t: "action", seq: 1, action: { x: 7, y: 7 } });
  var applied = await ws1.wait("actionApplied");
  assert.deepEqual(applied.action, { x: 7, y: 7 });
  assert.equal(applied.state.board[7][7], 1);
  await ws0.wait("actionApplied", null, 2000).catch(() => { }); // 消費 ws0 自己的廣播，保持後續時序
  // seq 只回動作者
  var appliedTo0 = ws0.received.filter(m => m.t === "actionApplied")[0];
  assert.equal(appliedTo0.seq, 1);
  var appliedTo1 = ws1.received.filter(m => m.t === "actionApplied")[0];
  assert.equal(appliedTo1.seq, undefined);

  // 非輪到者被拒
  ws0.send({ t: "action", seq: 2, action: { x: 6, y: 6 } });
  var invalid = await ws0.wait("invalid");
  assert.ok(invalid.message);

  // 聊天（觀眾也可以）
  ws2.send({ t: "chat", text: "加油！" });
  var chat = await ws1.wait("chat");
  assert.equal(chat.msg.text, "加油！");
  assert.equal(chat.msg.from, "spectator");

  // 戰情中心：訂閱 lobby 後應列出滿座對局
  ws2.send({ t: "subscribeLobby" });
  var lobbyMsg = await ws2.wait("lobby", null, 1500);
  var summary = lobbyMsg.games.find(g => g.roomId === room.roomId);
  assert.ok(summary, "戰情中心應列出滿座對局");
  assert.equal(summary.players[0].color, "black");

  // 下到黑棋五連（第一手 (7,7) 後輪到白棋，先白後黑；黑棋 x=3 縱線五連；白棋散子不成五）
  var moves = [[9, 6], [3, 3], [11, 5], [3, 4], [9, 4], [3, 5], [12, 3], [3, 6], [9, 2], [3, 7]];
  for (var i = 0; i < moves.length; i++) {
    var seat = i % 2 === 0 ? 1 : 0; // 第一個動作輪白棋（黑已下 (7,7)）
    var wsX = seat === 0 ? ws0 : ws1;
    var otherWs = seat === 0 ? ws1 : ws0;
    wsX.send({ t: "action", seq: i + 2, action: { x: moves[i][0], y: moves[i][1] } });
    // 動作者與對方各自的廣播副本都要消費，保持時序不錯位
    await wsX.wait("actionApplied", null, 2000);
    await otherWs.wait("actionApplied", null, 2000);
  }
  var over0 = await ws0.wait("gameOver", null, 2000);
  assert.equal(over0.reason, "five");
  assert.equal(over0.winnerIndex, 0);

  // 再來一局（seat 1 提議、seat 0 同意）→ 換先手
  ws1.send({ t: "rematch" });
  await ws0.wait("rematchOffered", null, 2000);
  ws0.send({ t: "rematchResponse", accept: true });
  var start1 = await ws1.wait("rematchStart", null, 2000);
  assert.equal(start1.blackSeat, 1); // 先手交換
  assert.equal(start1.state.moves.length, 0);

  ws0.ws.close(); ws1.ws.close(); ws2.ws.close();
});

test("整合：斷線重連以 token 認領座位並收到完整快照", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll ? built.closeAll() : built.server.close(); });

  var room = await createRoom(built, "阿黑", "freestyle");
  var ws0 = await openWs(built.wsUrl);
  var ws1 = await openWs(built.wsUrl);
  t.after(function () { ws0.ws.close(); ws1.ws.close(); });

  ws0.send({ t: "join", roomId: room.roomId, playerToken: room.playerToken, name: "阿黑" });
  await ws0.wait("joined");
  ws1.send({ t: "join", roomId: room.roomId, name: "阿白" });
  await ws1.wait("joined");

  ws0.send({ t: "action", seq: 1, action: { x: 7, y: 7 } });
  await ws1.wait("actionApplied", null, 2000);

  // ws0 斷線重連（新 WS 帶原 token）
  ws0.ws.close();
  var ws0b = await openWs(built.wsUrl);
  t.after(function () { ws0b.ws.close(); });
  ws0b.send({ t: "join", roomId: room.roomId, playerToken: room.playerToken, name: "阿黑" });
  var j0b = await ws0b.wait("joined", null, 2000);
  assert.equal(j0b.seat, 0);
  assert.equal(j0b.state.moves.length, 1, "重連收到完整狀態快照");
  assert.equal(j0b.playerToken, room.playerToken);
});

test("整合：HTTP /api/games 只列滿座進行中對局；/r/:roomId 回 SPA", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll ? built.closeAll() : built.server.close(); });

  var room = await createRoom(built, "阿黑", "standard");
  var res0 = await fetch(built.base + "/api/games");
  var data0 = await res0.json();
  assert.equal(data0.games.find(g => g.roomId === room.roomId), undefined, "waiting 不列");

  var ws0 = await openWs(built.wsUrl);
  var ws1 = await openWs(built.wsUrl);
  t.after(function () { ws0.ws.close(); ws1.ws.close(); });
  ws0.send({ t: "join", roomId: room.roomId, playerToken: room.playerToken, name: "阿黑" });
  await ws0.wait("joined");
  ws1.send({ t: "join", roomId: room.roomId, name: "阿白" });
  await ws1.wait("joined");

  var res = await fetch(built.base + "/api/games");
  var data = await res.json();
  var g = data.games.find(x => x.roomId === room.roomId);
  assert.ok(g, "滿座 playing 應列出");
  assert.equal(g.turnNumber, 0);

  var spa = await fetch(built.base + "/r/" + room.roomId);
  assert.equal(spa.status, 200);
  var html = await spa.text();
  assert.ok(html.indexOf("app.js") >= 0, "回 SPA shell");
});

test("整合：/online 回 SPA shell（線上對戰深連結／重新整理）", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll ? built.closeAll() : built.server.close(); });

  var res = await fetch(built.base + "/online");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  var html = await res.text();
  assert.ok(html.indexOf("app.js") >= 0, "回 SPA shell");
  assert.ok(html.indexOf('id="screen-entry"') >= 0, "shell 內含入口首頁");
});

test("整合：/api/games 戰情中心曝光規則 — status 欄位、等待房 30 秒曝光、終局保留", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll ? built.closeAll() : built.server.close(); });

  var room = await createRoom(built, "阿黑", "standard");
  var ws0 = await openWs(built.wsUrl);
  var ws1 = await openWs(built.wsUrl);
  var ws2 = await openWs(built.wsUrl); // 戰情中心訂閱者
  t.after(function () { ws0.ws.close(); ws1.ws.close(); ws2.ws.close(); });

  // 剛建立的 waiting 房：不列（快取房規則由 isLobbyListable 把關）
  var res0 = await fetch(built.base + "/api/games");
  assert.equal((await res0.json()).games.find(g => g.roomId === room.roomId), undefined, "waiting 30 秒內不列");

  ws0.send({ t: "join", roomId: room.roomId, playerToken: room.playerToken, name: "阿黑" });
  await ws0.wait("joined");
  ws1.send({ t: "join", roomId: room.roomId, name: "阿白" });
  await ws1.wait("joined");

  // 滿座 playing：列出且帶 status
  var res1 = await fetch(built.base + "/api/games");
  var playing = (await res1.json()).games.find(g => g.roomId === room.roomId);
  assert.ok(playing, "滿座 playing 應列出");
  assert.equal(playing.status, "playing");

  // WS lobby 推播同樣帶 status 欄位
  ws2.send({ t: "subscribeLobby" });
  var lobbyMsg = await ws2.wait("lobby", null, 1500);
  var pushed = lobbyMsg.games.find(g => g.roomId === room.roomId);
  assert.ok(pushed, "訂閱者應收到 lobby 推播");
  assert.equal(pushed.status, "playing");

  // 等待房滿 30 秒後應公開曝光（把 createdAt 往回撥 31 秒，不必等真實 30 秒）
  var room2 = await createRoom(built, "等三十秒", "standard");
  var r2 = built.manager.cache.get(room2.roomId);
  r2.createdAt = Date.now() - 31000;
  var res2 = await fetch(built.base + "/api/games");
  var listed2 = (await res2.json()).games.find(g => g.roomId === room2.roomId);
  assert.ok(listed2, "等待房滿 30 秒應公開曝光");
  assert.equal(listed2.status, "waiting");

  // 認輸終局 → finished 保留期內列出
  ws0.send({ t: "resign" });
  await ws1.wait("gameOver", null, 2000);
  var res3 = await fetch(built.base + "/api/games");
  var finishedRow = (await res3.json()).games.find(g => g.roomId === room.roomId);
  assert.ok(finishedRow, "終局應在保留期內列出");
  assert.equal(finishedRow.status, "finished");
});

test("整合：未知房型 / 錯誤訊息 → error 碼", async (t) => {
  var built = await startServer();
  t.after(function () { built.closeAll ? built.closeAll() : built.server.close(); });

  var ws = await openWs(built.wsUrl);
  t.after(function () { ws.ws.close(); });
  ws.send({ t: "join", roomId: "zzzzzzzzzz", name: "阿鬼" });
  var err = await ws.wait("error", null, 2000);
  assert.equal(err.code, "room-not-found");

  ws.send("not-json");
  var bad = await ws.wait("error", m => m.code === "bad-message", 2000);
  assert.ok(bad);
});