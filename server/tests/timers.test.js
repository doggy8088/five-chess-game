"use strict";
/* 回合鐘與斷線寬限測試（§4）：deadline 惰性判定、鐘暫停、寬限重連恢復、重啟救援。 */

var test = require("node:test");
var assert = require("node:assert");
var utils = require("./server-test-utils.js");
var Room = require("../room.js").Room;

function setDeadline(room, deltaMs) {
  room.turn.deadlineAt = Date.now() + deltaMs;
}
function setGrace(room, deltaMs) {
  room.turn.graceDeadlineAt = Date.now() + deltaMs;
}

test("計時：行動鐘逾期判負（timeout），deadline 含 serverNow", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  var dto = room.deadlineDTO();
  assert.ok(dto && dto.at > Date.now());
  assert.ok(dto.serverNow <= Date.now());

  setDeadline(room, -1); // 已逾期
  room.evaluate();
  var over = ctx.transport.last("s0", "gameOver");
  assert.ok(over);
  assert.equal(over.reason, "timeout");
  assert.equal(over.winnerIndex, 1); // 黑方（s0）逾時，白方勝
  assert.equal(room.status, "finished");
});

test("計時：輪到者斷線 → 鐘暫停 + 開寬限窗", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  var beforeDeadline = room.turn.deadlineAt;
  room.disconnect("s0");
  assert.equal(room.turn.deadlineAt, null, "鐘應暫停（不繼續跑）");
  assert.equal(room.turn.pausedRemainingMs > 0, true);
  assert.ok(room.turn.graceDeadlineAt > Date.now());
  assert.ok(beforeDeadline);
});

test("計時：寬限逾期判 forfeit（對方勝）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.disconnect("s0");
  setGrace(room, -1);
  room.evaluate();
  var over = ctx.transport.last("s1", "gameOver");
  assert.ok(over);
  assert.equal(over.reason, "forfeit");
  assert.equal(over.winnerIndex, 1);
});

test("計時：寬限內重連恢復剩餘時間", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  var remainingBefore = room.turn.deadlineAt - Date.now();
  room.disconnect("s0");
  var paused = room.turn.pausedRemainingMs;
  assert.ok(Math.abs(paused - remainingBefore) < 50, "暫停值應為當下剩餘");

  // 寬限內以 token 重連
  room.join("s0b", { roomId: room.roomId, playerToken: room.seats[0].token, name: "阿黑" });
  assert.equal(room.turn.deadlineAt > Date.now(), true, "deadline 應恢復");
  assert.equal(room.turn.pausedRemainingMs, null);
  assert.equal(room.turn.graceDeadlineAt, null);
  var resumed = room.turn.deadlineAt - Date.now();
  assert.ok(Math.abs(resumed - paused) < 50, "恢復後剩餘時間應等於暫停時剩餘");
});

test("計時：輪到離線者直接開寬限鐘（deadline 暫停）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.disconnect("s1"); // 白棋（非輪到方）斷線：鐘不受影響
  assert.ok(room.turn.deadlineAt);
  room.handleAction("s0", 0, { seq: 1, action: { x: 7, y: 7 } }); // 輪到白棋（離線）
  assert.equal(room.turn.deadlineAt, null);
  assert.equal(room.turn.pausedRemainingMs, 60_000);
  assert.ok(room.turn.graceDeadlineAt > Date.now());
  var grace = ctx.transport.last("s0", "deadline").deadline;
  assert.equal(grace.seat, 1);
  assert.equal(grace.at, null);
  assert.ok(grace.graceAt);
});

test("計時：非輪到者斷線不影響鐘", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  var before = room.turn.deadlineAt;
  room.disconnect("s1");
  assert.equal(room.turn.deadlineAt, before);
  assert.equal(room.turn.graceDeadlineAt, null);
});

test("計時：長停機後復活不溯及判負（行動鐘轉暫停+全新寬限）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.handleAction("s0", 0, { seq: 1, action: { x: 7, y: 7 } });
  // 模擬停機 1 小時：deadline 早已過期
  room.turn.deadlineAt = Date.now() - 3600_000;
  room.turn.pausedRemainingMs = null;
  room.turn.graceDeadlineAt = null;
  var doc = JSON.parse(JSON.stringify(room.toDoc()));
  // 直接 evaluate（未重啟）會判負——但重啟載入後救援機制介入：
  var rebuilt = Room.fromDoc(doc);
  rebuilt.evaluate(); // evaluate 會先跑，但 _restartRescue 已把 deadline 轉為暫停+寬限
  assert.equal(rebuilt.status, "playing", "重啟救援不得溯及判負");
  assert.ok(rebuilt.turn.graceDeadlineAt > Date.now());
  assert.ok(rebuilt.turn.pausedRemainingMs >= 10_000);
  assert.equal(rebuilt.turn.deadlineAt, null);
});

test("計時：短重啟鐘轉入寬限（剩餘至少 10 秒）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.turn.deadlineAt = Date.now() + 5_000; // 只剩 5 秒
  var doc = JSON.parse(JSON.stringify(room.toDoc()));
  var rebuilt = Room.fromDoc(doc);
  assert.ok(rebuilt.turn.pausedRemainingMs >= 10_000, "至少剩 10 秒可思考");
  assert.ok(rebuilt.turn.graceDeadlineAt > Date.now());
});

test("計時：原本在寬限的房間重啟 → 寬限重算為 now + GRACE", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.disconnect("s0"); // 進入寬限
  var doc = JSON.parse(JSON.stringify(room.toDoc()));
  var rebuilt = Room.fromDoc(doc);
  assert.ok(rebuilt.turn.graceDeadlineAt > Date.now());
  assert.ok(rebuilt.turn.deadlineAt === null);
});

test("計時：waiting 房沒有鐘", () => {
  var ctx = utils.makeRoom();
  var room = ctx.room;
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token });
  assert.equal(room.deadlineDTO(), null);
  assert.equal(room.turn.deadlineAt, null);
});

test("計時：finished 房清鐘", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.resign("s0", 0);
  assert.equal(room.deadlineDTO(), null);
  assert.equal(room.turn.deadlineAt, null);
  assert.equal(room.turn.graceDeadlineAt, null);
});

test("計時：重啟後 evaluate 對 finished 房無作用", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.resign("s0", 0);
  var doc = JSON.parse(JSON.stringify(room.toDoc()));
  var rebuilt = Room.fromDoc(doc);
  rebuilt.turn.deadlineAt = Date.now() - 9999;
  rebuilt.evaluate();
  assert.equal(rebuilt.status, "finished");
  assert.equal(rebuilt.result.reason, "resign");
});

test("計時：disconnect 後 evaluate 會即時結算寬限逾期", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.disconnect("s0");
  room.turn.graceDeadlineAt = Date.now() - 1; // 模擬時間已過（同步情境）
  room.evaluate();
  assert.equal(room.status, "finished");
  assert.equal(room.result.reason, "forfeit");
});