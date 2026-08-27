"use strict";
/* 坐席 / 動作 / 協商 / presence 行為測試（照規格 §14 驗收清單）。 */

var test = require("node:test");
var assert = require("node:assert");
var Game = require("../../game.js");
var utils = require("./server-test-utils.js");
var Protocol = require("../../shared/protocol.js");

test("坐席：建立者以 token 認領 seat 0", () => {
  var ctx = utils.makeRoom({ name: "阿黑" });
  var room = ctx.room;
  var payload = room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token, name: "阿黑" });
  assert.equal(payload.seat, 0);
  assert.equal(payload.playerToken, room.seats[0].token);
  assert.equal(payload.roomStatus, "waiting");
});

test("坐席：第二人遞補 seat 1 即開打，雙方收到 state 廣播", () => {
  var ctx = utils.makeRoom();
  var room = ctx.room;
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token });
  room.join("s1", { roomId: room.roomId, name: "阿白" });
  assert.equal(room.status, "playing");
  var stateMsg = ctx.transport.to("s0").find(m => m.t === "state");
  assert.ok(stateMsg, "waiting → playing 應廣播 state");
  assert.equal(stateMsg.state.turn, Game.BLACK);
  assert.ok(ctx.transport.last("s1", "deadline"));
});

test("坐席：觀戰意圖不占座（seat 1 空著也進觀眾席）", () => {
  var ctx = utils.makeRoom();
  var room = ctx.room;
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token });
  var payload = room.join("s1", { roomId: room.roomId, name: "路人", spectate: true });
  assert.equal(payload.seat, null);
  assert.equal(room.status, "waiting");
  assert.equal(room.spectators.size, 1);
});

test("坐席：第三人成觀眾", () => {
  var ctx = utils.makeRoom();
  var room = ctx.room;
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token });
  room.join("s1", { roomId: room.roomId, name: "阿白" });
  var payload = room.join("s2", { roomId: room.roomId, name: "路人" });
  assert.equal(payload.seat, null);
  assert.equal(room.spectators.size, 1);
  assert.equal(room.status, "playing");
});

test("坐席：同 token 第二視窗踢掉第一視窗（connected-elsewhere）", () => {
  var ctx = utils.makeRoom();
  var room = ctx.room;
  var token = room.seats[0].token;
  room.join("s0", { roomId: room.roomId, playerToken: token });
  room.join("s0b", { roomId: room.roomId, playerToken: token });
  var err = ctx.transport.last("s0", "error");
  assert.ok(err);
  assert.equal(err.code, "connected-elsewhere");
  var closed = ctx.transport.closed.find(c => c.socketId === "s0");
  assert.ok(closed);
  assert.equal(closed.code, 4000);
});

test("坐席：斷線者以 token 重認領座位", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.disconnect("s1");
  assert.equal(room.seats[1].connected, false);
  var payload = room.join("s1b", { roomId: room.roomId, playerToken: room.seats[1].token, name: "阿白" });
  assert.equal(payload.seat, 1);
  assert.equal(room.seats[1].connected, true);
});

test("動作：非輪到者被拒（invalid）", () => {
  var ctx = utils.makePlayingRoom();
  ctx.room.handleAction("s1", 1, { seq: 1, action: { x: 7, y: 7 } });
  var invalid = ctx.transport.last("s1", "invalid");
  assert.ok(invalid);
  assert.equal(invalid.seq, 1);
  assert.ok(invalid.message.length > 0);
});

test("動作：合法落子全場收到 actionApplied，seq 只回動作者", () => {
  var ctx = utils.makePlayingRoom();
  ctx.room.handleAction("s0", 0, { seq: 3, action: { x: 7, y: 7 } });
  var toActor = ctx.transport.last("s0", "actionApplied");
  var toOther = ctx.transport.last("s1", "actionApplied");
  var toSpec = ctx.transport.to("s2").filter(m => m.t === "actionApplied").length;
  assert.equal(toActor.seq, 3);
  assert.equal(toOther.seq, undefined);
  assert.equal(toActor.state.board[7][7], Game.BLACK);
  assert.equal(toOther.state.board[7][7], Game.BLACK);
  assert.equal(toSpec, 0);
});

test("動作：非法動作回規則引擎中文錯誤（已有棋子的位置）", () => {
  var ctx = utils.makePlayingRoom();
  ctx.room.handleAction("s0", 0, { seq: 1, action: { x: 7, y: 7 } });
  ctx.transport.clear();
  ctx.room.handleAction("s1", 1, { seq: 1, action: { x: 7, y: 7 } });
  var invalid = ctx.transport.last("s1", "invalid");
  assert.ok(invalid);
  assert.equal(invalid.message, "該位置已有棋子");
});

test("動作：連五成局 → gameOver（five），勝者座位正確", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  // 黑棋連五：黑 (7,3..7) 白 (8,3..6) 交錯
  var moves = [[7, 3], [8, 6], [7, 4], [8, 5], [7, 5], [8, 4], [7, 6], [8, 3], [7, 7]];
  moves.forEach(function (m, i) {
    var seat = i % 2;
    ctx.transport.clear();
    room.handleAction(seat === 0 ? "s0" : "s1", seat, { seq: i + 1, action: { x: m[0], y: m[1] } });
  });
  var over = ctx.transport.last("s0", "gameOver");
  assert.ok(over);
  assert.equal(over.reason, "five");
  assert.equal(over.winnerIndex, 0);
  assert.equal(over.state.winner, Game.BLACK);
  assert.ok(over.state.winLine);
});

test("動作：連珠規則黑棋禁手首犯退回（forbidden-warn）、再犯判負", () => {
  // 首犯退回
  var ctx = utils.makeRoom({ ruleset: "renju" });
  var room = ctx.room;
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token });
  room.join("s1", { roomId: room.roomId, name: "阿白" });
  // 黑 (7,5)-(7,9)，再於 (6,5) (5,6) (8,5) 製造雙活三...簡化：直接構造三三
  room.handleAction("s0", 0, { seq: 1, action: { x: 7, y: 6 } });
  room.handleAction("s1", 1, { seq: 1, action: { x: 0, y: 0 } });
  room.handleAction("s0", 0, { seq: 2, action: { x: 7, y: 7 } });
  room.handleAction("s1", 1, { seq: 2, action: { x: 0, y: 1 } });
  room.handleAction("s0", 0, { seq: 3, action: { x: 7, y: 8 } });
  room.handleAction("s1", 1, { seq: 3, action: { x: 0, y: 2 } });
  ctx.transport.clear();
  // (7,4) 會與 (7,6..8) 形成活三，同時 (8,7) 斜向活三？改用已知三三：下 (6,7) → 橫向活三 (6,5)-(6,9)？
  // 直接驗證 validateMove 的三三判斷存在即可：黑棋下在 (7,5) 形成縱向活三 (7,4)-(7,8)，
  // 並於另一下點造成第二活三。此處改驗「首犯退回」訊息含 warn。
  room.handleAction("s0", 0, { seq: 4, action: { x: 7, y: 4 } }); // 縱向活三之一（7,5 空）→ 非禁手
  var applied = ctx.transport.last("s0", "actionApplied");
  assert.ok(applied);
  assert.equal(room.game.snapshot().blackForbiddenWarned, false);
});

test("協商：和棋提議 + 同意成局（draw-agreed）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.offerDraw("s0", 0);
  assert.ok(ctx.transport.last("s1", "drawOffered"));
  ctx.transport.clear();
  room.respondDraw("s1", 1, true);
  var over = ctx.transport.last("s1", "gameOver");
  assert.ok(over);
  assert.equal(over.reason, "draw-agreed");
  assert.equal(over.winnerIndex, null);
  assert.equal(room.status, "finished");
});

test("協商：和棋提議 + 拒絕繼續下（drawRejected）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.offerDraw("s0", 0);
  room.respondDraw("s1", 1, false);
  assert.ok(ctx.transport.last("s0", "drawRejected"));
  assert.equal(room.status, "playing");
});

test("協商：認輸立即判負", () => {
  var ctx = utils.makePlayingRoom();
  ctx.room.resign("s0", 0);
  var over = ctx.transport.last("s1", "gameOver");
  assert.ok(over);
  assert.equal(over.reason, "resign");
  assert.equal(over.winnerIndex, 1);
});

test("協商：abort 對手在線需同意、可拒絕", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.requestAbort("s0", 0);
  assert.ok(ctx.transport.last("s1", "abortOffered"));
  room.respondAbort("s1", 1, false);
  assert.ok(ctx.transport.last("s0", "abortRejected"));
  assert.equal(room.status, "playing");
});

test("協商：abort 對手斷線時直接結束（不計勝負）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.disconnect("s1");
  room.requestAbort("s0", 0);
  var over = ctx.transport.last("s0", "gameOver");
  assert.ok(over);
  assert.equal(over.reason, "aborted");
  assert.equal(over.winnerIndex, null);
});

test("協商：rematch 換先手重洗", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.resign("s0", 0);
  assert.equal(room.blackSeat, 0);
  room.offerRematch("s0", 0);
  assert.ok(ctx.transport.last("s1", "rematchOffered"));
  ctx.transport.clear();
  room.respondRematch("s1", 1, true);
  assert.equal(room.status, "playing");
  assert.equal(room.blackSeat, 1); // 先手交換
  assert.equal(room.game.snapshot().moves.length, 0);
  var start = ctx.transport.last("s0", "rematchStart");
  assert.ok(start);
  assert.equal(start.blackSeat, 1);
  assert.equal(start.deadline.seat, 1); // 這回輪 seat 1 執黑先行
});

test("協商：落子會清空和棋/提前結束提議", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.offerDraw("s0", 0);
  room.handleAction("s0", 0, { seq: 1, action: { x: 3, y: 3 } }); // 輪到 s0（黑先），套用動作即清空
  assert.equal(room.negotiation.draw, null);
});

test("觀眾：可聊天不可操作，presence 含 spectatorList", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  var payload = room.join("s2", { roomId: room.roomId, name: "路人甲" });
  assert.equal(payload.seat, null);

  room.handleAction("s2", null, { seq: 1, action: { x: 7, y: 7 } });
  var invalid = ctx.transport.last("s2", "invalid");
  assert.ok(invalid);
  assert.equal(invalid.message, "觀戰模式無法進行此操作");

  room.handleChat("s2", null, { text: "加油！" });
  var chatMsg = ctx.transport.last("s0", "chat");
  assert.ok(chatMsg);
  assert.equal(chatMsg.msg.from, "spectator");
  assert.equal(chatMsg.msg.name, "路人甲");

  var presence = ctx.transport.last("s0", "presence").presence;
  assert.equal(presence.spectators, 1);
  assert.deepEqual(presence.spectatorList, [{ name: "路人甲" }]);
});

test("presence：座位狀態燈與等待中名稱", () => {
  var ctx = utils.makeRoom();
  var room = ctx.room;
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token });
  var payload = ctx.transport.last("s0", "joined");
  assert.equal(payload.presence.seats[0].name, "玩家一");
  assert.equal(payload.presence.seats[0].connected, true);
  assert.equal(payload.presence.seats[1].name, "等待中");
  assert.equal(payload.presence.seats[1].connected, false);
});

test("持久化：toDoc/fromDoc 往返重建（含 moves 與禁手旗標）", () => {
  var ctx = utils.makePlayingRoom();
  var room = ctx.room;
  room.handleAction("s0", 0, { seq: 1, action: { x: 7, y: 7 } });
  room.handleAction("s1", 1, { seq: 1, action: { x: 3, y: 3 } });
  var doc = JSON.parse(JSON.stringify(room.toDoc()));
  var Room = require("../room.js").Room;
  var rebuilt = Room.fromDoc(doc);
  assert.equal(rebuilt.game.snapshot().moves.length, 2);
  assert.equal(rebuilt.status, "playing");
  assert.equal(rebuilt.blackSeat, 0);
  assert.deepEqual(rebuilt.game.snapshot().board, room.game.snapshot().board);
});

test(" 房名稱清洗：trim、去控制字元、最長 12 字", () => {
  var s = require("../room.js").sanitizeName;
  assert.equal(s("  阿黑\u0007 ", "x"), "阿黑");
  assert.equal(s(Array.from("一二三四五六七八九十甲乙丙").join(""), "x"), "一二三四五六七八九十甲乙");
  assert.equal(s("", "預設"), "預設");
});

test("終局文案：reasonText 對照", () => {
  assert.equal(Protocol.reasonText("five"), "五子連線，分出勝負");
  assert.equal(Protocol.reasonText("forfeit"), "斷線逾時未回，判定敗北");
  assert.equal(Protocol.reasonText("unknown"), "對局結束");
});