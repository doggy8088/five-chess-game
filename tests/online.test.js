"use strict";
/* 客戶端通訊層測試：session 訊息路由、deadline 倒數（時鐘偏移）、重連退避、token 儲存。 */

var test = require("node:test");
var assert = require("node:assert");
var path = require("path");

var socketMod = require("../online/socket.js");
var sessionMod = require("../online/session.js");
var tokens = require("../online/tokens.js");
var P = require("../shared/protocol.js");
var Game = require("../game.js");

/* ---- FakeWebSocket / FakeSocket ---- */

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sent = [];
    var ws = this;
    setTimeout(function () { ws.readyState = 1; if (ws.onopen) ws.onopen(); }, 0);
  }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
}

// 可控的假 socket：手動觸發 open/message/close，記錄送出訊息
class FakeSocket {
  constructor(opts) {
    this.opts = opts;
    this.sent = [];
    this.closed = false;
    var self = this;
    setTimeout(function () { if (self.opts.onOpen) self.opts.onOpen(); }, 0);
  }
  connect() { }
  send(obj) { this.sent.push(obj); }
  close() { this.closed = true; }
  wireVisibility() { }
  // 測試用：模擬 server 下行
  emit(msg) { if (this.opts.onMessage) this.opts.onMessage(msg); }
}

/* ---- session 路由 ---- */

function makeSession(cbOverrides) {
  var sockets = [];
  var session = new sessionMod.OnlineSession(Object.assign({
    roomId: "abcdefghjk",
    socketClass: function (opts) { var s = new FakeSocket(opts); sockets.push(s); return s; }
  }, cbOverrides));
  return { session: session, sockets: sockets };
}

test("session：onOpen 重送 join（帶 token/name/spectate）", async (t) => {
  var s = makeSession({});
  t.after(() => s.session.dispose());
  s.session.connect();
  await new Promise(r => setTimeout(r, 5));
  var sent = s.session.socket.sent[0];
  assert.equal(sent.t, "join");
  assert.equal(sent.roomId, "abcdefghjk");
  assert.equal(sent.spectate, undefined);
});

test("session：joined 路由 → seat/blackSeat/chatHistory/presence/onJoined", async (t) => {
  var events = [];
  var s = makeSession({
    onJoined: m => events.push(["joined", m]),
    onChatHistory: c => events.push(["chatHistory", c]),
    onPresence: p => events.push(["presence", p])
  });
  t.after(() => s.session.dispose());
  s.session.connect();
  await new Promise(r => setTimeout(r, 5));
  s.session.socket.opts.onMessage({
    t: "joined", roomId: "abcdefghjk", seat: 1, blackSeat: 0, roomStatus: "playing",
    playerToken: "tok123",
    state: { moves: [] }, deadline: null,
    chat: [{ id: "c1", from: 0, kind: "text", text: "hi", at: 1 }],
    presence: { seats: [{ name: "A", connected: true }, { name: "B", connected: true }], spectators: 0, spectatorList: [] },
    gameOver: null
  });
  assert.equal(s.session.seat, 1);
  assert.equal(s.session.playerToken, "tok123");
  assert.ok(events.some(e => e[0] === "joined"));
  assert.ok(events.some(e => e[0] === "chatHistory" && e[1][0].text === "hi"));
  assert.ok(events.some(e => e[0] === "presence"));
});

test("session：actionApplied/invalid/chat/gameOver 路由", async (t) => {
  var events = [];
  var s = makeSession({
    onActionApplied: m => events.push(["applied", m]),
    onInvalid: m => events.push(["invalid", m]),
    onChat: m => events.push(["chat", m]),
    onGameOver: m => events.push(["gameOver", m])
  });
  t.after(() => s.session.dispose());
  s.session.connect();
  await new Promise(r => setTimeout(r, 5));
  var sock = s.session.socket;
  sock.opts.onMessage({ t: "actionApplied", by: 0, action: { x: 7, y: 7 }, state: { moves: [{ x: 7, y: 7, player: 1 }] }, deadline: null });
  sock.opts.onMessage({ t: "invalid", seq: 2, message: "還沒輪到你" });
  sock.opts.onMessage({ t: "chat", msg: { id: "c", from: 1, kind: "text", text: "好棋", at: 2 } });
  sock.opts.onMessage({ t: "gameOver", reason: "five", winnerIndex: 0, state: { winner: 1 } });
  assert.ok(events.some(e => e[0] === "applied" && e[1].action.x === 7));
  assert.ok(events.some(e => e[0] === "invalid" && e[1].message === "還沒輪到你"));
  assert.ok(events.some(e => e[0] === "chat" && e[1].text === "好棋"));
  assert.ok(events.some(e => e[0] === "gameOver" && e[1].reason === "five"));
});

test("session：deadline 倒數含時鐘偏移校正（250ms tick）", async (t) => {
  var ticks = [];
  var s = makeSession({ onCountdown: info => ticks.push(info) });
  t.after(() => s.session.dispose());
  s.session.connect();
  await new Promise(r => setTimeout(r, 5));
  var serverNow = Date.now() - 5000; // 伺服器時鐘比客戶端慢 5 秒
  s.session.socket.opts.onMessage({
    t: "deadline",
    deadline: { seat: 0, at: serverNow + 30000, serverNow: serverNow }
  });
  var first = ticks[ticks.length - 1];
  // 伺服器時鐘慢 5 秒：未校正會算出 ~25s；校正後應為 ~30s（以伺服器時鐘為準）
  assert.ok(first.remainingMs > 29700 && first.remainingMs < 30300, "偏移校正後剩餘應約 30s：" + first.remainingMs);
  await new Promise(r => setTimeout(r, 600));
  assert.ok(ticks.length >= 3, "每 250ms tick");
  s.session.dispose();
});

test("session：seq 遞增且 sendAction 送出 action", async (t) => {
  var s = makeSession({});
  t.after(() => s.session.dispose());
  s.session.connect();
  await new Promise(r => setTimeout(r, 5));
  var seq1 = s.session.sendAction(3, 4);
  var seq2 = s.session.sendAction(5, 6);
  assert.equal(seq1, 1);
  assert.equal(seq2, 2);
  var actions = s.session.socket.sent.filter(m => m.t === "action");
  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].action, { x: 3, y: 4 });
});

test("session：error 碼分流（room-not-found / rate-limited / connected-elsewhere）", async (t) => {
  var events = [];
  var s = makeSession({
    onRoomNotFound: m => events.push(["room-not-found", m]),
    onRateLimited: m => events.push(["rate-limited", m]),
    onConnectedElsewhere: m => events.push(["connected-elsewhere", m])
  });
  t.after(() => s.session.dispose());
  s.session.connect();
  await new Promise(r => setTimeout(r, 5));
  var sock = s.session.socket;
  sock.opts.onMessage({ t: "error", code: "room-not-found", message: "找不到對局" });
  sock.opts.onMessage({ t: "error", code: "rate-limited", message: "訊息太頻繁" });
  sock.opts.onMessage({ t: "error", code: "connected-elsewhere", message: "你已在其他視窗加入" });
  assert.ok(events.some(e => e[0] === "room-not-found"));
  assert.ok(events.some(e => e[0] === "rate-limited"));
  assert.ok(events.some(e => e[0] === "connected-elsewhere"));
  assert.equal(sock.closed, true, "connected-elsewhere 後不再重連");
});

/* ---- ReconnectingSocket ---- */

// 最小 WebSocket stub（global 注入）
class StubWS {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    StubWS.instances.push(this);
    var ws = this;
    this._openTimer = setTimeout(function () { ws.readyState = 1; if (ws.onopen) ws.onopen(); }, 1);
  }
  send(raw) { this.sent.push(raw); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
}
StubWS.instances = [];

test("socket：斷線後指數退避重連（1s→1.7s）", async (t) => {
  var stub = global.WebSocket;
  global.WebSocket = StubWS;
  StubWS.instances = [];
  try {
    var attempts = [];
    var sock = new socketMod.ReconnectingSocket({
      url: "ws://test/ws",
      onOpen: function () { attempts++; }
    });
    sock.onRetryScheduled = function (delay) { delays.push(delay); };
    var attempts = 0;
    var delays = [];
    sock.connect();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(attempts, 1);
    assert.equal(StubWS.instances.length, 1);
    // 模擬斷線
    StubWS.instances[0].onclose();
    // 立刻 schedule 1s（不等到真正重連，只驗證退避值）
    assert.ok(delays.length === 1 && delays[0] >= 900 && delays[0] <= 1100, "第一次退避約 1s：" + delays[0]);
    sock.close();
    await new Promise(r => setTimeout(r, 10));
  } finally {
    if (stub === undefined) delete global.WebSocket; else global.WebSocket = stub;
  }
});