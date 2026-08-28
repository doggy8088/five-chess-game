"use strict";
/* 上行訊息白名窄化測試（guards）。 */

var test = require("node:test");
var assert = require("node:assert");
var guardMessage = require("../guards.js").guardMessage;

test("guards：未知 t 一律丟棄", () => {
  assert.equal(guardMessage({ t: "hack" }), null);
  assert.equal(guardMessage({}), null);
  assert.equal(guardMessage(null), null);
  assert.equal(guardMessage("hello"), null);
  assert.equal(guardMessage(42), null);
});

test("guards：join 欄位驗型與截斷", () => {
  var ok = guardMessage({ t: "join", roomId: "abcdefghjk", playerToken: "tok", name: "小明", spectate: true });
  assert.equal(ok.roomId, "abcdefghjk");
  assert.equal(ok.playerToken, "tok");
  assert.equal(ok.name, "小明");
  assert.equal(ok.spectate, true);

  assert.equal(guardMessage({ t: "join" }), null, "缺 roomId");
  assert.equal(guardMessage({ t: "join", roomId: 42 }), null, "roomId 非字串");
  assert.equal(guardMessage({ t: "join", roomId: "" }), null, "空 roomId");
  var long = guardMessage({ t: "join", roomId: "x".repeat(100), name: "n".repeat(100), playerToken: "t".repeat(100) });
  assert.equal(long.roomId.length, 24);
  assert.equal(long.name.length, 24);
  assert.equal(long.playerToken.length, 64);
});

test("guards：action 逐欄位驗型（x/y 必須整數）", () => {
  assert.deepEqual(guardMessage({ t: "action", seq: 1, action: { x: 7, y: 7 } }), { t: "action", seq: 1, action: { x: 7, y: 7 } });
  assert.equal(guardMessage({ t: "action", seq: 0, action: { x: 1, y: 1 } }), null, "seq 需 ≥1");
  assert.equal(guardMessage({ t: "action", seq: 1.5, action: { x: 1, y: 1 } }), null, "seq 需整數");
  assert.equal(guardMessage({ t: "action", seq: 1, action: { x: "a", y: 1 } }), null, "x 需整數");
  assert.equal(guardMessage({ t: "action", seq: 1, action: { x: 1.2, y: 1 } }), null, "x 需整數");
  assert.equal(guardMessage({ t: "action", seq: 1 }), null, "缺 action");
});

test("guards：chat 截斷 500、canned 上限 32", () => {
  var c = guardMessage({ t: "chat", text: "x".repeat(1000) });
  assert.equal(c.text.length, 500);
  assert.equal(guardMessage({ t: "chat", text: 42 }), null);
  var canned = guardMessage({ t: "canned", id: "i".repeat(100) });
  assert.equal(canned.id.length, 32);
  assert.equal(guardMessage({ t: "canned", id: "" }), null);
});

test("guards：回應類訊息 accept 必須為 boolean", () => {
  assert.equal(guardMessage({ t: "drawResponse", accept: true }).accept, true);
  assert.equal(guardMessage({ t: "abortResponse", accept: false }).accept, false);
  assert.equal(guardMessage({ t: "rematchResponse", accept: "yes" }), null);
  assert.equal(guardMessage({ t: "drawResponse" }), null);
});

test("guards：無欄位訊息直接放行", () => {
  ["subscribeLobby", "drawOffer", "abortRequest", "resign", "rematch"].forEach(function (t) {
    assert.deepEqual(guardMessage({ t: t }), { t: t });
  });
});

test("guards：announcementAck 驗 id 字串、剝控制字元、截斷 64", () => {
  var ok = guardMessage({ t: "announcementAck", id: "6f9c1e5a-1234-4abc-9def-0123456789ab" });
  assert.deepEqual(ok, { t: "announcementAck", id: "6f9c1e5a-1234-4abc-9def-0123456789ab" });

  var long = guardMessage({ t: "announcementAck", id: "i".repeat(100) });
  assert.equal(long.id.length, 64);

  assert.equal(guardMessage({ t: "announcementAck", id: 42 }), null, "id 非字串");
  assert.equal(guardMessage({ t: "announcementAck" }), null, "缺 id");
  assert.equal(guardMessage({ t: "announcementAck", id: "" }), null, "空 id");
  assert.equal(guardMessage({ t: "announcementAck", id: "\u0007" }), null, "剝除控制字元後為空");
  assert.equal(guardMessage({ t: "announcementAck", id: "ab\u0007cd" }).id, "abcd", "控制字元被剝除");
});