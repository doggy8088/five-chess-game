"use strict";
/* WS 入口 + HTTP API：靜態檔、/healthz、/api/health、/api/games、POST /api/rooms、
   /r/:roomId SPA 路由、/ws upgrade、30s 心跳、大廳訂閱推播。 */

var path = require("path");
var http = require("http");
var express = require("express");
var WebSocket = require("ws");

var config = require("./config.js");
var Protocol = require("../shared/protocol.js");
var guards = require("./guards.js");
var ids = require("./ids.js");
var roomMod = require("./room.js");
var storeMod = require("./store.js");
var roomsMod = require("./rooms.js");

function createServer(opts) {
  opts = opts || {};
  var app = express();
  var rootDir = path.join(__dirname, "..");

  // ---- HTTP ----
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
    res.sendFile(path.join(rootDir, "index.html"), { headers: { "Cache-Control": "no-cache" } });
  });

  // 靜態檔：HTML 不快取（避免部署後拿到舊殼）、其他資產快取 1 小時（以 ?v= 版本控制）
  app.use(express.static(rootDir, {
    index: "index.html",
    setHeaders: function (res, filePath) {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      else res.setHeader("Cache-Control", "public, max-age=3600");
    }
  }));

  // ---- WS ----
  var server = http.createServer(app);
  var wss = new WebSocket.Server({ server: server, path: "/ws" });

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

  if (!manager) {
    var store = opts.store || new storeMod.InMemoryStore();
    manager = new roomsMod.RoomManager(store, transport);
  }
  manager.startSweepTimer();

  wss.on("connection", function (ws) {
    var socketId = "s" + (nextSocketId++);
    ws.isAlive = true;
    ws.socketId = socketId;
    ws.roomId = null;
    ws.seat = null;
    sockets.set(socketId, ws);

    ws.on("pong", function () { ws.isAlive = true; });

    ws.on("message", function (raw) {
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

  return { app: app, server: server, wss: wss, manager: manager, transport: transport };
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

  var built = createServer({ store: store });
  var port = config.PORT;
  built.server.listen(port, function () {
    console.log("[server] 五子棋線上對戰伺服器已啟動：http://localhost:%d（v%s）", port, config.VERSION);
  });
}

module.exports = { createServer: createServer };