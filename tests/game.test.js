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
// 防禦／活叉：困難等級的核心（防止被活叉輕鬆反殺）
// ------------------------------------------------------------
test("threatScore 偵測活棋，活四分數高於活三", () => {
  var b3 = G.emptyBoard(15); b3[7][7] = G.BLACK; b3[7][8] = G.BLACK; b3[7][9] = G.BLACK;        // 活三
  var b4 = G.emptyBoard(15); b4[7][7] = G.BLACK; b4[7][8] = G.BLACK; b4[7][9] = G.BLACK; b4[7][10] = G.BLACK; // 活四
  var s3 = G.threatScore(b3, G.BLACK, 5);
  var s4 = G.threatScore(b4, G.BLACK, 5);
  assert.ok(s3 > 0, "活三有分數");
  assert.ok(s4 > s3, "活四分數高於活三");
});

test("threatScore 辨識活叉（兩個活三）分數顯著高於單活三", () => {
  var single = G.emptyBoard(15); single[7][7] = G.BLACK; single[7][8] = G.BLACK; single[7][9] = G.BLACK;
  var fork = G.emptyBoard(15);
  fork[7][7] = G.BLACK; fork[7][8] = G.BLACK; fork[7][9] = G.BLACK;   // 橫向活三
  fork[8][7] = G.BLACK; fork[9][7] = G.BLACK;                          // 縱向活三（共用 7,7）→ 活叉
  var sf = G.threatScore(fork, G.BLACK, 5);
  var ss = G.threatScore(single, G.BLACK, 5);
  assert.ok(sf > ss * 3, "活叉分數應顯著高於單活三");
});

test("evalBoard 認出對手活叉的危險（防禦不再被低估）", () => {
  var flat = G.emptyBoard(15); flat[7][7] = G.WHITE;
  var fork = G.emptyBoard(15);
  fork[7][7] = G.BLACK; fork[7][8] = G.BLACK; fork[7][9] = G.BLACK;
  fork[8][7] = G.BLACK; fork[9][7] = G.BLACK;
  assert.equal(G.evalBoard(flat, G.WHITE, G.BLACK, 5), 0, "平局形勢評分為 0");
  assert.ok(G.evalBoard(fork, G.WHITE, G.BLACK, 5) < -10000, "遭遇對手活叉時評分應極負");
});

test("chooseMove 困難：面對活叉會防禦／還擊，而非放任", () => {
  var mk = function () {
    var b = G.emptyBoard(15);
    b[7][7] = G.BLACK; b[7][8] = G.BLACK; b[7][9] = G.BLACK;  // 橫向活三
    b[8][7] = G.BLACK; b[9][7] = G.BLACK;                     // 縱向活三（活叉）
    b[8][9] = G.WHITE;                                         // AI 附近有點（避免走中央）
    return b;
     };
  var before = G.threatScore(mk(), G.BLACK, 5);
  var m = G.chooseMove(mk(), G.WHITE, G.BLACK, 5, "hard");
  var after = G.cloneBoard(mk()); after[m[0]][m[1]] = G.WHITE;
  var humanThreat = G.threatScore(after, G.BLACK, 5);
  var aiThreat = G.threatScore(after, G.WHITE, 5);
  assert.equal(after[m[0]][m[1]], G.WHITE, "確實落子");
  assert.ok(humanThreat < before, "對手威脅分數下降（活叉被破／被擋）");
  assert.ok(humanThreat < 40000 || aiThreat >= 40000, "活叉被破，或 AI 反建活叉");
});

test("regression：威脅型人類再無法輕鬆贏困難 AI（困難不應弱於中等）", () => {
  // 模擬會「擋活三、造活叉」的會下棋對手。舊版困難在 12 局中 12 局敗，
  // 新版困難（威脅感知搜索）應穩定不敗。
  function tScore(board, who) { return G.threatScore(board, who, 5); }
  function scriptedHuman(board) {
    var win = G.findWinningMove(board, G.BLACK, 5); if (win) return win;
    var block = G.findWinningMove(board, G.WHITE, 5); if (block) return block;
    var cs = G.candidateCells(board, 2);
    var best = null, bestS = -Infinity;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      board[c[0]][c[1]] = G.BLACK;
      var s = tScore(board, G.BLACK) + 0.6 * tScore(board, G.WHITE);
      board[c[0]][c[1]] = G.EMPTY;
      if (s > bestS) { bestS = s; best = c; }
      }
    return best || [7, 7];
     }
  var humanWins = 0, games = 12;
  for (var g = 0; g < games; g++) {
    var board = G.emptyBoard(15);
    var mover = G.BLACK;
    for (var t = 0; t < 226; t++) {
      var m = (mover === G.BLACK)
        ? scriptedHuman(board)
        : G.chooseMove(board, G.WHITE, G.BLACK, 5, "hard");
      if (!m || !G.isLegalMove(board, m[0], m[1])) {
        m = G.greedyMove(board, mover, G.opponentOf(mover), 5, 0);
     }
      if (!m || !G.isLegalMove(board, m[0], m[1])) break;   // 棋盤將滿
      board[m[0]][m[1]] = mover;
      if (G.winningLine(board, m[0], m[1], mover, 5)) {
        if (mover === G.BLACK) humanWins++;
        break;
        }
      mover = mover === G.BLACK ? G.WHITE : G.BLACK;
      }
    }
  assert.ok(humanWins <= 1, "困難 AI 不應被威脅型人類穩壓（humanWins=" + humanWins + "/" + games + "）");
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

// ------------------------------------------------------------
// 黑棋禁手：雙活三（三三）
// 先手黑棋不得同時形成兩個活三；首犯退回一手並警告，當局再犯判負。
// 白棋不受限；五連勝利優先於禁手。
// ------------------------------------------------------------
test("isOpenThree / isDoubleOpenThree 偵測活三與雙活三", () => {
  var b = G.emptyBoard(15);
  b[7][5] = G.BLACK; b[7][6] = G.BLACK; b[7][7] = G.BLACK;        // 橫向活三 .XXX.
  assert.equal(G.isOpenThree(b, 7, 7, G.BLACK, 0, 1), true, "橫向活三");
  b[5][7] = G.BLACK; b[6][7] = G.BLACK;                            // 加縱向活三（共用 7,7）
  assert.equal(G.isOpenThree(b, 7, 7, G.BLACK, 1, 0), true, "縱向活三");
  assert.equal(G.isDoubleOpenThree(b, 7, 7, G.BLACK), true, "雙活三");
  var s = G.emptyBoard(15); s[7][5] = G.BLACK; s[7][6] = G.BLACK; s[7][7] = G.BLACK;
  assert.equal(G.isDoubleOpenThree(s, 7, 7, G.BLACK), false, "僅一個活三非雙活三");
  var c = G.emptyBoard(15); c[7][6] = G.BLACK; c[7][7] = G.BLACK; c[7][8] = G.BLACK;
  c[7][5] = G.WHITE; c[7][9] = G.WHITE;                            // OXXXO → 眠三
  assert.equal(G.isOpenThree(c, 7, 7, G.BLACK, 0, 1), false, "兩端被堵非活三");
});

test("isForbiddenMove：黑棋雙活三為禁手，五連勝利優先", () => {
  var b = G.emptyBoard(15);
  b[7][5] = G.BLACK; b[7][6] = G.BLACK;
  b[5][7] = G.BLACK; b[6][7] = G.BLACK;
  assert.equal(G.isForbiddenMove(b, 7, 7, G.BLACK, 5), true, "(7,7) 落黑成雙活三 → 禁手");
  assert.equal(G.isForbiddenMove(b, 7, 7, G.WHITE, 5), false, "白棋永不禁手");
  var w = G.emptyBoard(15);
  w[7][5] = G.BLACK; w[7][6] = G.BLACK; w[7][7] = G.BLACK; w[7][8] = G.BLACK;
  assert.equal(G.isForbiddenMove(w, 7, 9, G.BLACK, 5), false, "成五連非禁手（勝利優先）");
  assert.equal(G.isForbiddenMove(G.emptyBoard(15), 7, 7, G.BLACK, 5), false, "孤立一手非禁手");
});

test("place 黑棋雙活三：首犯退回、再犯判負", () => {
  var g = G.createGame({ vsAI: false });
  g.place(7, 5, G.BLACK); g.place(0, 0, G.WHITE);
  g.place(7, 6, G.BLACK); g.place(1, 2, G.WHITE);
  g.place(5, 7, G.BLACK); g.place(2, 4, G.WHITE);
  g.place(6, 7, G.BLACK); g.place(3, 6, G.WHITE);
  assert.equal(g.blackForbiddenWarned, false);
  // (7,7) 同時形成橫向與縱向活三 → 雙活三，首犯退回
  var r = g.place(7, 7, G.BLACK);
  assert.equal(r, false, "首犯雙活三：此手被退回");
  assert.equal(g.board[7][7], G.EMPTY, "退回後該格為空");
  assert.equal(g.currentPlayer(), G.BLACK, "仍輪黑棋重下");
  assert.equal(g.blackForbiddenWarned, true, "已記錄一次警告");
  assert.ok(g.forbiddenWarn, "產生禁手提示座標");
  // 黑棋改下合法手
  assert.equal(g.place(8, 8, G.BLACK), true);
  g.place(4, 8, G.WHITE);
  // 再次於 (7,7) 形成雙活三 → 當局再犯，黑棋判負
  var r3 = g.place(7, 7, G.BLACK);
  assert.equal(r3, true, "再犯：棋局結束回 true");
  assert.equal(g.winner, G.WHITE, "黑棋判負，白棋勝");
  assert.equal(g.forbidden, true);
  assert.equal(g.board[7][7], G.BLACK, "再犯之手保留以顯示犯規位置");
  assert.ok(g.isOver());
});

test("place 白棋雙活三不受限（禁手僅限黑棋）", () => {
  var g = G.createGame({ vsAI: false });
  g.place(0, 0, G.BLACK); g.place(7, 5, G.WHITE);
  g.place(0, 5, G.BLACK); g.place(7, 6, G.WHITE);
  g.place(0, 10, G.BLACK); g.place(5, 7, G.WHITE);
  g.place(1, 3, G.BLACK); g.place(6, 7, G.WHITE);
  g.place(2, 8, G.BLACK);   // 黑棋 filler，換白棋
  var r = g.place(7, 7, G.WHITE);
  assert.equal(r, true, "白棋雙活三可下");
  assert.equal(g.board[7][7], G.WHITE);
  assert.equal(g.winner, null, "白棋不判負");
  assert.equal(g.currentPlayer(), G.BLACK, "換黑棋");
});

test("chooseMove 黑棋會避開雙活三禁手", () => {
  var b = G.emptyBoard(15);
  b[7][5] = G.BLACK; b[7][6] = G.BLACK;
  b[5][7] = G.BLACK; b[6][7] = G.BLACK;
  // (7,7) 是雙活三禁手；chooseMove（hard, 黑）不應選它
  var m = G.chooseMove(b, G.BLACK, G.WHITE, 5, "hard");
  assert.ok(!(m[0] === 7 && m[1] === 7), "不選禁手 (7,7)");
  assert.equal(b[m[0]][m[1]], G.EMPTY, "落點為空");
  assert.equal(G.isForbiddenMove(b, m[0], m[1], G.BLACK, 5), false, "所選非禁手");
});

test("aiMove（AI 為黑）避開雙活三、不自我判負", () => {
  var g = G.createGame({ vsAI: true, aiPlayer: G.BLACK, difficulty: "hard" });
  g.board[7][5] = G.BLACK; g.board[7][6] = G.BLACK; g.board[5][7] = G.BLACK; g.board[6][7] = G.BLACK;
  g.turn = G.BLACK;
  var m = g.aiMove();
  assert.ok(m, "AI 回傳落點");
  assert.ok(!(m.x === 7 && m.y === 7), "AI 不選禁手 (7,7)");
  assert.equal(g.winner, null, "未自我判負");
  assert.equal(g.forbidden, false);
  assert.equal(g.board[m.x][m.y], G.BLACK, "確實落子");
  assert.equal(g.currentPlayer(), G.WHITE, "輪到白棋");
});

test("reset / nextRound 清除雙活三警告狀態", () => {
  var g = G.createGame({ vsAI: false });
  g.place(7, 5, G.BLACK); g.place(0, 0, G.WHITE);
  g.place(7, 6, G.BLACK); g.place(1, 2, G.WHITE);
  g.place(5, 7, G.BLACK); g.place(2, 4, G.WHITE);
  g.place(6, 7, G.BLACK); g.place(3, 6, G.WHITE);
  g.place(7, 7, G.BLACK);   // 首犯退回 → warned=true
  assert.equal(g.blackForbiddenWarned, true);
  g.reset();
  assert.equal(g.blackForbiddenWarned, false, "reset 清除警告");
  assert.equal(g.forbidden, false);
  g.nextRound();
  assert.equal(g.blackForbiddenWarned, false, "nextRound 清除警告");
});

// ------------------------------------------------------------
// 黑棋禁手：四四（雙四）與長連
// 四四：同一手同時形成兩個以上的四（活四或衝四）。
// 長連：黑棋連出六子以上（超過五子），不算勝，直接判禁手。
// 五連勝利優先於禁手；白棋不受限（僅精準五連為勝）。
// ------------------------------------------------------------
test("winningFiveLine：精準五連回傳連線，長連回傳 null", () => {
  var b = G.emptyBoard(15);
  b[7][7] = G.BLACK; b[7][8] = G.BLACK; b[7][9] = G.BLACK; b[7][10] = G.BLACK; b[7][11] = G.BLACK;
  var line = G.winningFiveLine(b, 7, 9, G.BLACK, 5);
  assert.ok(line && line.length === 5, "5 連回傳 5 格");
  var c = G.emptyBoard(15);
  for (var y = 7; y <= 12; y++) c[7][y] = G.BLACK;
  assert.equal(G.winningFiveLine(c, 7, 9, G.BLACK, 5), null, "6 連非精準五連 → null");
});

test("isFive / isOverline 偵測精準五連與長連", () => {
  var b = G.emptyBoard(15);
  b[7][6] = G.BLACK; b[7][7] = G.BLACK; b[7][8] = G.BLACK; b[7][9] = G.BLACK; b[7][10] = G.BLACK;
  assert.equal(G.isFive(b, 7, 7, G.BLACK, 5), true, "剛好 5 連為精準五連");
  assert.equal(G.isOverline(b, 7, 7, G.BLACK, 5), false, "5 連非長連");
  var c = G.emptyBoard(15);
  for (var y = 5; y <= 10; y++) c[7][y] = G.BLACK;
  assert.equal(G.isFive(c, 7, 7, G.BLACK, 5), false, "6 連非精準五連");
  assert.equal(G.isOverline(c, 7, 7, G.BLACK, 5), true, "6 連為長連");
  var d = G.emptyBoard(15);
  d[7][7] = G.BLACK; d[7][8] = G.BLACK; d[7][9] = G.BLACK; d[7][10] = G.BLACK;
  assert.equal(G.isFive(d, 7, 7, G.BLACK, 5), false);
  assert.equal(G.isOverline(d, 7, 7, G.BLACK, 5), false);
});

test("isFourThrough / isDoubleFour 偵測四與雙四", () => {
  // 橫向活四：(7,7..7,10) 4 連，兩端空
  var b = G.emptyBoard(15);
  b[7][7] = G.BLACK; b[7][8] = G.BLACK; b[7][9] = G.BLACK; b[7][10] = G.BLACK;
  assert.equal(G.isFourThrough(b, 7, 7, G.BLACK, 0, 1, 5), true, "橫向活四為四");
  assert.equal(G.isDoubleFour(b, 7, 7, G.BLACK, 5), false, "單四非雙四");
  // 單四（3 連下成 4）非禁手
  var s = G.emptyBoard(15); s[7][8] = G.BLACK; s[7][9] = G.BLACK; s[7][10] = G.BLACK;
  assert.equal(G.isForbiddenMove(s, 7, 7, G.BLACK, 5), false, "單四非禁手");
  // (7,7) 空格，落子後同時成橫向與縱向四 → 雙四禁手
  var e = G.emptyBoard(15);
  e[7][8] = G.BLACK; e[7][9] = G.BLACK; e[7][10] = G.BLACK;   // 橫向 3（(7,7) 補成 4 連）
  e[6][7] = G.BLACK; e[5][7] = G.BLACK; e[4][7] = G.BLACK;    // 縱向 3（(7,7) 補成 4 連）
  assert.equal(G.forbiddenReason(e, 7, 7, G.BLACK, 5), "doubleFour", "(7,7) 成雙四禁手");
  assert.equal(G.isForbiddenMove(e, 7, 7, G.BLACK, 5), true, "雙四為禁手");
});

test("isForbiddenMove：黑棋長連為禁手，白棋長連不受限", () => {
  // 黑棋 3 連 + 2 連（隔一格），下 (7,10) 成 6 連
  var b = G.emptyBoard(15);
  b[7][7] = G.BLACK; b[7][8] = G.BLACK; b[7][9] = G.BLACK;
  b[7][11] = G.BLACK; b[7][12] = G.BLACK;
  b[7][10] = G.BLACK;                                       // 暫時落子驗證
  assert.equal(G.isOverline(b, 7, 10, G.BLACK, 5), true, "落子後成 6 連長連");
  assert.equal(G.isFive(b, 7, 10, G.BLACK, 5), false, "6 連非精準五連");
  b[7][10] = G.EMPTY;                                       // 還原
  assert.equal(G.isForbiddenMove(b, 7, 10, G.BLACK, 5), true, "黑棋長連為禁手");
  assert.equal(G.forbiddenReason(b, 7, 10, G.BLACK, 5), "overline", "禁手類型為長連");
  assert.equal(G.isForbiddenMove(b, 7, 10, G.WHITE, 5), false, "白棋長連非禁手");
});

test("place 黑棋長連：首犯退回、再犯判負", () => {
  var g = G.createGame({ vsAI: false });
  g.place(7, 7, G.BLACK); g.place(0, 0, G.WHITE);
  g.place(7, 8, G.BLACK); g.place(0, 5, G.WHITE);
  g.place(7, 9, G.BLACK); g.place(1, 2, G.WHITE);
  g.place(7, 11, G.BLACK); g.place(2, 9, G.WHITE);
  g.place(7, 12, G.BLACK); g.place(3, 4, G.WHITE);
  // (7,10) → 6 連 → 長連禁手，首犯退回
  var r = g.place(7, 10, G.BLACK);
  assert.equal(r, false, "首犯長連：此手被退回");
  assert.equal(g.board[7][10], G.EMPTY, "退回後該格為空");
  assert.equal(g.blackForbiddenWarned, true, "已記錄一次警告");
  assert.equal(g.forbiddenWarn.type, "overline", "禁手類型為長連");
  // 黑棋改下合法手
  assert.equal(g.place(8, 8, G.BLACK), true);
  g.place(6, 3, G.WHITE);
  // 再犯長連 → 黑棋判負
  var r3 = g.place(7, 10, G.BLACK);
  assert.equal(r3, true, "再犯：棋局結束回 true");
  assert.equal(g.winner, G.WHITE, "黑棋判負，白棋勝");
  assert.equal(g.forbidden, true);
  assert.equal(g.forbiddenType, "overline", "判負禁手類型為長連");
  assert.equal(g.board[7][10], G.BLACK, "再犯之手保留以顯示犯規位置");
  assert.ok(g.isOver());
});

test("place 黑棋四四：首犯退回、再犯判負", () => {
  var g = G.createGame({ vsAI: false });
  g.place(7, 8, G.BLACK); g.place(0, 0, G.WHITE);
  g.place(7, 9, G.BLACK); g.place(0, 5, G.WHITE);
  g.place(7, 10, G.BLACK); g.place(1, 2, G.WHITE);
  g.place(6, 7, G.BLACK); g.place(2, 9, G.WHITE);
  g.place(5, 7, G.BLACK); g.place(3, 4, G.WHITE);
  g.place(4, 7, G.BLACK); g.place(5, 5, G.WHITE);
  // (7,7) 同時成橫向與縱向四 → 四四禁手，首犯退回
  var r = g.place(7, 7, G.BLACK);
  assert.equal(r, false, "首犯四四：此手被退回");
  assert.equal(g.board[7][7], G.EMPTY, "退回後該格為空");
  assert.equal(g.blackForbiddenWarned, true, "已記錄一次警告");
  assert.equal(g.forbiddenWarn.type, "doubleFour", "禁手類型為四四");
  // 黑棋改下合法手
  assert.equal(g.place(8, 8, G.BLACK), true);
  g.place(6, 3, G.WHITE);
  // 再犯四四 → 黑棋判負
  var r3 = g.place(7, 7, G.BLACK);
  assert.equal(r3, true, "再犯：棋局結束回 true");
  assert.equal(g.winner, G.WHITE, "黑棋判負，白棋勝");
  assert.equal(g.forbidden, true);
  assert.equal(g.forbiddenType, "doubleFour", "判負禁手類型為四四");
  assert.ok(g.isOver());
});

test("place 白棋長連不判負也不勝（白棋無禁手，僅精準五連為勝）", () => {
  var g = G.createGame({ vsAI: false });
  g.place(0, 0, G.BLACK); g.place(7, 7, G.WHITE);
  g.place(0, 5, G.BLACK); g.place(7, 8, G.WHITE);
  g.place(1, 2, G.BLACK); g.place(7, 9, G.WHITE);
  g.place(2, 9, G.BLACK); g.place(7, 11, G.WHITE);
  g.place(3, 4, G.BLACK); g.place(7, 12, G.WHITE);
  g.place(6, 3, G.BLACK);   // filler，換白棋
  // 白棋 (7,10) → 6 連（長連）：白棋無禁手，且僅精準五連為勝 → 不勝也不判負
  var r = g.place(7, 10, G.WHITE);
  assert.equal(r, true, "白棋長連可下（不判負）");
  assert.equal(g.winner, null, "白棋長連不勝（僅精準五連為勝）");
  assert.equal(g.board[7][10], G.WHITE, "白棋已落子");
  assert.equal(g.currentPlayer(), G.BLACK, "換黑棋");
});

test("chooseMove 黑棋會避開長連禁手", () => {
  var b = G.emptyBoard(15);
  b[7][7] = G.BLACK; b[7][8] = G.BLACK; b[7][9] = G.BLACK;
  b[7][11] = G.BLACK; b[7][12] = G.BLACK;
  // (7,10) 會成 6 連（長連禁手）；chooseMove（黑）不應選它
  var m = G.chooseMove(b, G.BLACK, G.WHITE, 5, "hard");
  assert.ok(!(m[0] === 7 && m[1] === 10), "不選長連禁手 (7,10)");
  assert.equal(G.isForbiddenMove(b, m[0], m[1], G.BLACK, 5), false, "所選非禁手");
});
