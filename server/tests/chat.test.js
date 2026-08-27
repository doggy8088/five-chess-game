"use strict";
/* 聊天測試（§6）：雙方收到、canned 白名單、限速、清洗、50 則尾巴、觀眾可聊。 */

var test = require("node:test");
var assert = require("node:assert");
var utils = require("./server-test-utils.js");
var Protocol = require("../../shared/protocol.js");
var sanitizeChatText = require("../room.js").sanitizeChatText;

test("聊天：座位雙方與觀眾都收到，座位訊息以 seat 署名", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.join("s2", { roomId: room.roomId, name: "觀眾甲" });
  ctx.transport.clear();
  room.handleChat("s0", 0, { text: "你好！" });
  var to0 = ctx.transport.last("s0", "chat");
  var to1 = ctx.transport.last("s1", "chat");
  var toSpec = ctx.transport.last("s2", "chat");
  assert.ok(to0 && to1 && toSpec);
  assert.equal(to0.msg.from, 0);
  assert.equal(to1.msg.from, 0);
  assert.equal(toSpec.msg.from, 0);
});

test("聊天：觀眾訊息帶名稱署名（from='spectator'）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.join("s2", { roomId: room.roomId, name: "觀眾甲" });
  ctx.transport.clear();
  room.handleChat("s2", null, { text: "幫黑棋加油" });
  var msg = ctx.transport.last("s0", "chat").msg;
  assert.equal(msg.from, "spectator");
  assert.equal(msg.name, "觀眾甲");
});

test("聊天：canned 白名單全 id 可用、未知 id 丟棄", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  Object.keys(Protocol.CANNED_MESSAGES).forEach(function (id) {
    room.chatLimits.clear(); // 測試跳過限速
    room.handleCanned("s0", 0, { id: id });
    var msg = ctx.transport.last("s1", "chat");
    assert.ok(msg, "id " + id + " 應可用");
    assert.equal(msg.msg.kind, "canned");
    assert.equal(msg.msg.text, Protocol.CANNED_MESSAGES[id]);
    ctx.transport.clear();
  });
  room.handleCanned("s0", 0, { id: "unknown-id" });
  assert.equal(ctx.transport.last("s1", "chat"), null);
});

test("聊天：超過 burst 限速（rate-limited 錯誤回給本人）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  for (var i = 0; i < 5; i++) room.handleChat("s0", 0, { text: "訊息" + i });
  ctx.transport.clear();
  room.handleChat("s0", 0, { text: "第六則" });
  var err = ctx.transport.last("s0", "error");
  assert.ok(err);
  assert.equal(err.code, "rate-limited");
  assert.equal(ctx.transport.last("s1", "chat"), null);
});

test("聊天：最小間隔限制（600ms 內第二則被擋）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.handleChat("s0", 0, { text: "第一則" });
  ctx.transport.clear();
  room.handleChat("s0", 0, { text: "第二則太快" });
  var err = ctx.transport.last("s0", "error");
  assert.ok(err);
  assert.equal(err.code, "rate-limited");
});

test("聊天：長度截斷與控制字元清除", () => {
  assert.equal(sanitizeChatText("  hi  "), "hi");
  assert.equal(sanitizeChatText("a\u0007b"), "ab");
  var long = Array.from("完".repeat(200)).join("");
  var cut = sanitizeChatText(long);
  assert.equal(Array.from(cut).length, 120);
  assert.equal(sanitizeChatText("   \u0001\u0002  "), null, "清洗後空白應丟棄");
});

test("聊天：空訊息丟棄", () => {
  var ctx = utils.makePlayingRoom();
  ctx.room.handleChat("s0", 0, { text: "    " });
  assert.equal(ctx.transport.to("s1").filter(m => m.t === "chat").length, 0);
});

test("聊天：重連補發尾巴（joined 內含 chat 歷史，上限 50 則）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  for (var i = 0; i < 55; i++) {
    room.chatLimits.clear(); // 測試跳過限速
    room.handleChat("s0", 0, { text: "訊息" + i });
  }
  assert.equal(room.chat.length, 50);
  ctx.transport.clear();
  var payload = room.join("s0b", { roomId: room.roomId, playerToken: room.seats[0].token });
  assert.equal(payload.chat.length, 50);
  assert.equal(payload.chat[0].text, "訊息5");
  assert.equal(payload.chat[49].text, "訊息54");
});

test("聊天：rate-limited 訊息不含在聊天歷史", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  for (var i = 0; i < 10; i++) room.handleChat("s0", 0, { text: "m" + i });
  assert.ok(room.chat.length < 10, "超過限速的訊息不進歷史");
  assert.ok(room.chat.every(function (m) { return m.text !== "m9"; }));
});