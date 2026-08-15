"use strict";
/* =====================================================================
 * 五子棋 — 邏輯單元測試（Node 內建 node:test，無第三方測試套件）
 * 僅測試純邏輯 module `../game.js`，避免瀏覽器／three.js 相依。
 * 執行： node --test tests/*.test.js
 * ===================================================================== */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const G = require("../game.js");

const realRandom = Math.random;
function setRandom(v) { Math.random = function () { return v; }; }

// ------------------------------------------------------------
// 基礎資料結構
// ------------------------------------------------------------
test("emptyBoard / cloneBoard / inBounds", () => {
  var b = G.emptyBoard(4);
  assert.equal(b.length, 4);
  assert.equal(b[0].length, 4);
  assert.ok(b[0] !== b[1]);
  assert.equal(b[0][0], G.EMPTY);
  var c = G.cloneBoard(b);
  assert.notEqual(c[0], b[0]);
  c[0][0] = G.BLACK;
  assert.equal(b[0][0], G.EMPTY, "deep copy 不可互相影響");
  assert.equal(G.inBounds(4, 0, 0), true);
  assert.equal(G.inBounds(4, 4, 0), false);
  assert.equal(G.inBounds(4, -1, 0), false);
});

test("opponentOf 黑白互補", () => {
  assert.equal(G.opponentOf(G.BLACK), G.WHITE);
  assert.equal(G.opponentOf(G.WHITE), G.BLACK);
});

test("isLegalMove 邊界與佔用", () => {
  var b = G.emptyBoard(5);
  assert.equal(G.isLegalMove(b, 0, 0), true);
  assert.equal(G.isLegalMove(b, 5, 0), false);
  assert.equal(G.isLegalMove(b, -1, 5), false);
  b[2][2] = G.BLACK;
  assert.equal(G.isLegalMove(b, 2, 2), false);
});

// ------------------------------------------------------------
// countLine / winningLine
// ------------------------------------------------------------
test("countLine 四方向與邊界", () => {
  var b = G.emptyBoard(9);
  b[4][4] = G.BLACK; b[4][5] = G.BLACK; b[4][6] = G.BLACK; b[5][3] = G.BLACK;
  assert.equal(G.countLine(b, 4, 5, G.BLACK, 0, 1), 3);
  assert.equal(G.countLine(b, 5, 3, G.BLACK, 1, 0), 1);
  assert.equal(G.countLine(b, 4, 4, G.BLACK, 1, 1), 1);
  var c = G.emptyBoard(9); c[0][0] = G.BLACK;
  assert.equal(G.countLine(c, 0, 0, G.BLACK, 0, 1), 1);
  assert.equal(G.countLine(c, 0, 0, G.BLACK, 1, 1), 1);
});

test("winningLine 四方向返回連線", () => {
  var b = G.emptyBoard(15);
  for (var x = 5; x <= 9; x++) b[x][7] = G.BLACK;
  for (var y = 5; y <= 9; y++) b[7][y] = G.WHITE;
  assert.ok(G.winningLine(b, 7, 7, G.BLACK, 5));
  assert.ok(G.winningLine(b, 7, 7, G.WHITE, 5));
  var d = G.emptyBoard(15);
  for (var i = 0; i < 5; i++) d[3 + i][3 + i] = G.BLACK;
  assert.ok(G.winningLine(d, 5, 5, G.BLACK, 5));
  var f = G.emptyBoard(15);
  for (var j = 0; j < 5; j++) f[3 + j][7 - j] = G.WHITE;
  assert.ok(G.winningLine(f, 5, 5, G.WHITE, 5));
});

test("winningLine 非五連返回 null，並取前 5 子", () => {
  var b = G.emptyBoard(15);
  assert.equal(G.winningLine(b, 7, 7, G.BLACK, 5), null);
  b[7][8] = G.BLACK;
  assert.equal(G.winningLine(b, 7, 7, G.BLACK, 5), null);
  b[7][9] = G.BLACK; b[7][10] = G.BLACK; b[7][6] = G.BLACK;
  assert.equal(G.winningLine(b, 7, 7, G.BLACK, 5).length, 5);
  assert.equal(G.winningLine(b, 7, 7, G.BLACK).length, 5);
});

// ------------------------------------------------------------
// patternScore 全分支
// ------------------------------------------------------------
test("patternScore 全分支", () => {
  assert.equal(G.patternScore(5, 0), 1000000);
  assert.equal(G.patternScore(6, 2), 1000000);
  assert.equal(G.patternScore(4, 0), 0);
  assert.equal(G.patternScore(3, 0), 0);
  assert.equal(G.patternScore(4, 2), 100000);
  assert.equal(G.patternScore(4, 1), 10000);
  assert.equal(G.patternScore(3, 2), 10000);
  assert.equal(G.patternScore(3, 1), 1000);
  assert.equal(G.patternScore(2, 2), 1000);
  assert.equal(G.patternScore(2, 1), 100);
  assert.equal(G.patternScore(1, 2), 100);
  assert.equal(G.patternScore(1, 1), 10);
  assert.equal(G.patternScore(0, 2), 0);
});

// ------------------------------------------------------------
// evaluateCell / centerBias / scoreCell / hasNeighbor / candidateCells
// ------------------------------------------------------------
test("evaluateCell 偵測開口型勢", () => {
  var b = G.emptyBoard(15);
  b[7][7] = G.BLACK; b[7][8] = G.BLACK; b[7][9] = G.BLACK;
  var near = G.evaluateCell(b, 7, 10, G.BLACK, 5);
  var far = G.evaluateCell(b, 0, 0, G.BLACK, 5);
  assert.ok(near > far, "貼近黑勢分數較高");
});

test("hasNeighbor 與 candidateCells", () => {
  var b = G.emptyBoard(9);
  assert.equal(G.hasNeighbor(b, 4, 4), false);
  b[4][4] = G.BLACK;
  b[5][5] = G.WHITE;
  assert.equal(G.hasNeighbor(b, 4, 4), true);
  assert.equal(G.hasNeighbor(b, 4, 4, 1), true);
  assert.ok(G.candidateCells(b).length > 0);
  assert.equal(G.candidateCells(G.emptyBoard(9)).length, 0);
});

test("centerBias 靠中心分數較高，且含預設 k", () => {
  var c = G.centerBias(7, 7, 15, 10);
  var e = G.centerBias(0, 0, 15, 10);
  assert.ok(c > e);
  assert.ok(G.centerBias(7, 7, 15) >= 0);
});

test("scoreCell 回傳綜合分數", () => {
  var b = G.emptyBoard(15);
  b[7][7] = G.BLACK; b[7][8] = G.BLACK;
  assert.equal(typeof G.scoreCell(b, 7, 9, G.BLACK, G.WHITE, 5), "number");
});

// ------------------------------------------------------------
// findWinningMove
// ------------------------------------------------------------
test("findWinningMove 找到殺著／無殺著", () => {
  var b = G.emptyBoard(15);
  b[7][7] = G.BLACK; b[7][8] = G.BLACK; b[7][9] = G.BLACK; b[7][10] = G.BLACK;
  var w = G.findWinningMove(b, G.BLACK, 5);
  assert.ok(w, "應找得到第 5 子");
  assert.ok(w[0] === 7 && (w[1] === 6 || w[1] === 11), "落點合理");
  assert.equal(G.findWinningMove(G.emptyBoard(15), G.BLACK, 5), null);
});

// ------------------------------------------------------------
// greedyMove / staticEval / minimax / chooseMove
// ------------------------------------------------------------
test("greedyMove 空白返回中央；有子觸發 jitter 分支", () => {
  var c = G.greedyMove(G.emptyBoard(15), G.BLACK, G.WHITE, 5, 0);
  assert.equal(c[0], 7);
  assert.equal(c[1], 7);
  var b2 = G.emptyBoard(15); b2[2][2] = G.WHITE;
  var c2 = G.greedyMove(b2, G.BLACK, G.WHITE, 5, 0.5);
  assert.equal(b2[c2[0]][c2[1]], G.EMPTY);
});

test("staticEval 回傳數字", () => {
  var b = G.emptyBoard(9); b[4][4] = G.BLACK;
  assert.equal(typeof G.staticEval(b, G.BLACK, G.WHITE, 5), "number");
});

test("minimax 回傳合法落點", () => {
  var b = G.emptyBoard(15);
  b[7][7] = G.BLACK; b[7][8] = G.WHITE; b[8][7] = G.WHITE;
  var m = G.minimax(b, G.WHITE, G.BLACK, 5);
  assert.ok(m, "應回傳落點");
  assert.equal(b[m[0]][m[1]], G.EMPTY, "落點為空");
});

test("chooseMove 空白棋盤走中央", () => {
  var m = G.chooseMove(G.emptyBoard(15), G.BLACK, G.WHITE, 5, "hard");
  assert.deepEqual(m, [7, 7]);
});

test("chooseMove 會立即取殺（hard 與 medium）", () => {
  var mk = function () {
    var b = G.emptyBoard(15);
    b[7][7] = G.BLACK; b[7][8] = G.BLACK; b[7][9] = G.BLACK; b[7][10] = G.BLACK;
    return b;
   };
  assert.equal(G.chooseMove(mk(), G.BLACK, G.WHITE, 5, "hard")[0], 7);
  assert.equal(G.chooseMove(mk(), G.BLACK, G.WHITE, 5, "medium")[0], 7);
});

test("chooseMove 會擋住對手殺著（medium）", () => {
  var b = G.emptyBoard(15);
  b[7][7] = G.WHITE; b[7][8] = G.WHITE; b[7][9] = G.WHITE; b[7][10] = G.WHITE;
  var m = G.chooseMove(b, G.BLACK, G.WHITE, 5, "medium");
  assert.ok(m[0] === 7 && (m[1] === 6 || m[1] === 11), "應擋白棋");
});

test("chooseMove easy 兩分支由 Math.random 控制", () => {
  var mk = function () {
    var b = G.emptyBoard(15);
    b[7][7] = G.WHITE; b[7][8] = G.WHITE; b[7][9] = G.WHITE; b[7][10] = G.WHITE;
    return b;
   };
  setRandom(0.1);
  assert.ok(G.chooseMove(mk(), G.BLACK, G.WHITE, 5, "easy").length === 2);
  setRandom(0.99);
  assert.ok(G.chooseMove(mk(), G.BLACK, G.WHITE, 5, "easy").length === 2);
  Math.random = realRandom;
});

// ------------------------------------------------------------
// createGame：控制器
// ------------------------------------------------------------
test("createGame 選項與預設", () => {
  var g = G.createGame({ size: 13, vsAI: true, difficulty: "easy", aiPlayer: G.BLACK });
  assert.equal(g.size, 13);
  assert.equal(g.difficulty, "easy");
  assert.equal(g.vsAI, true);
  assert.equal(g.aiPlayer, G.BLACK);
  assert.equal(g.humanPlayer, G.WHITE);
  assert.equal(g.stoneCount(), 0);
  assert.deepEqual(g.getBoard(), G.emptyBoard(13));
});

test("createGame 棋盤過小擲出 TOO_SMALL", () => {
  assert.throws(function () { G.createGame({ size: 3 }); }, { code: "TOO_SMALL" });
});

test("createGame vsAI=false 時 aiMove 回 null", () => {
  var g = G.createGame({ vsAI: false });
  assert.equal(g.aiPlayer, null);
  assert.equal(g.aiMove(), null);
});

test("place 合法／佔用／越界／棋局結束", () => {
  var g = G.createGame({ vsAI: false });
  assert.equal(g.place(7, 7), true);
  assert.equal(g.board[7][7], G.BLACK);
  assert.equal(g.currentPlayer(), G.WHITE);
  assert.equal(g.place(7, 7), false, "重複落子失敗");
  assert.equal(g.place(-1, -1), false, "越界失敗");
  assert.equal(g.place(15, 0), false, "越界失敗");
  assert.equal(g.isTurn(G.WHITE), true);
  assert.equal(g.isTurn(G.BLACK), false);
});

test("place 五連判定勝且 turn=null", () => {
  var g = G.createGame({ vsAI: false });
  g.place(7, 7, G.BLACK); g.place(7, 8, G.BLACK); g.place(7, 9, G.BLACK);
  g.place(7, 10, G.BLACK); g.place(7, 11, G.BLACK);
  assert.equal(g.winner, G.BLACK);
  assert.ok(g.isOver());
  assert.equal(g.turn, null);
  assert.equal(g.place(7, 12), false, "棋局結束後再落失敗");
});

test("aiMove 在 AI 回合產出合法落點、非 AI 回合回 null", () => {
  var g = G.createGame({ vsAI: true, aiPlayer: G.WHITE, difficulty: "hard" });
  g.place(7, 7, G.BLACK);
  assert.equal(g.currentPlayer(), G.WHITE);
  var m = g.aiMove();
  assert.ok(m && m.player === G.WHITE);
  assert.equal(g.board[m.x][m.y], G.WHITE);
  assert.equal(g.aiThinking, false);
  assert.equal(g.aiMove(), null, "非 AI 回合回 null");
});

test("aiMove 棋局結束時回 null", () => {
  var g = G.createGame({ vsAI: true, aiPlayer: G.WHITE, difficulty: "hard" });
  g.place(7, 7, G.BLACK); g.place(7, 8, G.BLACK); g.place(7, 9, G.BLACK);
  g.place(7, 10, G.BLACK); g.place(7, 11, G.BLACK);
  assert.equal(g.winner, G.BLACK);
  assert.equal(g.aiMove(), null, "已結束不應再行動");
});

test("undo 空棋盤／單 ply／vsAI 雙 ply／清除勝負", () => {
  var g = G.createGame({ vsAI: false });
  assert.equal(g.undo(), false, "空棋盤 undo 回 false");
  g.place(7, 7, G.BLACK);
  assert.equal(g.undo(), true);
  assert.equal(g.stoneCount(), 0);
  assert.equal(g.currentPlayer(), G.BLACK);

  var g2 = G.createGame({ vsAI: true, aiPlayer: G.WHITE, difficulty: "hard" });
  g2.place(7, 7, G.BLACK);
  g2.place(7, 8, G.WHITE);
  g2.place(8, 8, G.BLACK);
  g2.place(8, 9, G.WHITE);
  assert.equal(g2.stoneCount(), 4);
  g2.undo();
  assert.equal(g2.stoneCount(), 2, "vsAI 一次撤黑白各一手");
  assert.equal(g2.currentPlayer(), G.BLACK, "撤銷後輪到黑棋");

  var g3 = G.createGame({ vsAI: false });
  g3.place(7, 7, G.BLACK); g3.place(7, 8, G.BLACK);
  g3.place(7, 9, G.BLACK); g3.place(7, 10, G.BLACK); g3.place(7, 11, G.BLACK);
  assert.equal(g3.winner, G.BLACK);
  g3.undo();
  assert.equal(g3.winner, null);
  assert.equal(g3.isOver(), false);
});

test("snapshot / reset / nextRound", () => {
  var g = G.createGame({ vsAI: false });
  g.place(5, 5, G.BLACK);
  var snap = g.snapshot();
  assert.equal(snap.board[5][5], G.BLACK);
  assert.equal(snap.moves.length, 1);
  g.board[0][0] = G.BLACK;
  assert.equal(snap.board[0][0], G.EMPTY, "快照為獨立副本");
  g.reset();
  assert.equal(g.stoneCount(), 0);
  assert.equal(g.round, 1);
  g.nextRound();
  assert.equal(g.round, 2);
  assert.equal(g.stoneCount(), 0);
});

test("snapshot 回傳獨立 winLine 與 moves 副本", () => {
  var g = G.createGame({ vsAI: false });
  g.place(7, 7, G.BLACK); g.place(7, 8, G.BLACK);
  g.place(7, 9, G.BLACK); g.place(7, 10, G.BLACK); g.place(7, 11, G.BLACK);
  var s = g.snapshot();
  assert.equal(s.winner, G.BLACK);
  assert.ok(Array.isArray(s.winLine));
  var origLen = s.moves.length;
  s.moves.push({ x: 0, y: 0, player: G.BLACK });
  assert.equal(g.moves.length, origLen, "moves 為獨立副本");
});

test("createGame 預設 size=15、difficulty=hard、human=BLACK", () => {
  var g = G.createGame({ vsAI: true });
  assert.equal(g.size, 15);
  assert.equal(g.difficulty, "hard");
  assert.equal(g.aiPlayer, G.WHITE);
  assert.equal(g.humanPlayer, G.BLACK);
});

// ------------------------------------------------------------
// 端到端 smoke 測試
// ------------------------------------------------------------
test("smoke：AI vs AI 能進行並終局", () => {
  var g = G.createGame({ vsAI: false, difficulty: "hard" });
  var guard = 0;
  while (!g.isOver() && guard++ < 225) {
    var m = G.chooseMove(g.board, g.currentPlayer(), G.opponentOf(g.currentPlayer()), 5, "hard");
    g.place(m[0], m[1], g.currentPlayer());
   }
  assert.ok(g.isOver() || g.stoneCount() === 225);
});

test("smoke：小盤下滿可判定為和棋", () => {
  var b5 = G.createGame({ size: 5, vsAI: false, winLength: 100 });
  var moves = [];
  for (var xx = 0; xx < 5; xx++) for (var yy = 0; yy < 5; yy++) moves.push([xx, yy]);
  for (var i = 0; i < 25; i++) {
    b5.place(moves[i][0], moves[i][1], i % 2 === 0 ? G.BLACK : G.WHITE);
   }
  assert.equal(b5.winner, "draw");
  assert.ok(b5.isOver());
});
