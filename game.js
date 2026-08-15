/* =====================================================================
 * 五子棋 (Gomoku / Five Chess) — pure game logic
 * 純遊戲邏輯：無 DOM、無 three.js，可於瀏覽器與 Node 獨立測試。
 * UMD：Node 走 module.exports，瀏覽器掛到 window.Game。
 * ===================================================================== */
(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else if (root) root.Game = api;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this),
function () {
   "use strict";

  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var DIRS   = [[0, 1], [1, 0], [1, 1], [1, -1]]; // 橫、直、＼、／

  var Game = {};
  Game.EMPTY = EMPTY; Game.BLACK = BLACK; Game.WHITE = WHITE; Game.DIRS = DIRS;

  function emptyBoard(size) {
    var b = new Array(size);
    for (var x = 0; x < size; x++) b[x] = new Array(size).fill(EMPTY);
    return b;
   }

  function cloneBoard(board) {
    return board.map(function (row) { return row.slice(); });
   }

  function inBounds(size, x, y) {
    return x >= 0 && y >= 0 && x < size && y < size;
   }

  function isLegalMove(board, x, y) {
    return inBounds(board.length, x, y) && board[x][y] === EMPTY;
   }

  function opponentOf(p) { return p === BLACK ? WHITE : BLACK; }

  function countLine(board, x, y, who, dx, dy) {
    var size = board.length, count = 1;
    var nx = x + dx, ny = y + dy;
    while (inBounds(size, nx, ny) && board[nx][ny] === who) { count++; nx += dx; ny += dy; }
    nx = x - dx; ny = y - dy;
    while (inBounds(size, nx, ny) && board[nx][ny] === who) { count++; nx -= dx; ny -= dy; }
    return count;
   }

    // 若於 (x,y) 落子形成 >= min 子連線，回傳該連線所有格子；否則回傳 null。
  function winningLine(board, x, y, who, min) {
    var size = board.length, min = min || 5;
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      if (countLine(board, x, y, who, dx, dy) >= min) {
        var cells = [[x, y]];
        var nx = x + dx, ny = y + dy;
        while (inBounds(size, nx, ny) && board[nx][ny] === who) { cells.push([nx, ny]); nx += dx; ny += dy; }
        nx = x - dx; ny = y - dy;
        while (inBounds(size, nx, ny) && board[nx][ny] === who) { cells.unshift([nx, ny]); nx -= dx; ny -= dy; }
        return cells.slice(0, min);
        }
      }
    return null;
   }

  function patternScore(count, openEnds) {
    if (count >= 5) return 1000000;
    if (openEnds === 0) return 0;
    switch (count) {
      case 4: return openEnds === 2 ? 100000 : 10000;
      case 3: return openEnds === 2 ? 10000   : 1000;
      case 2: return openEnds === 2 ? 1000    : 100;
      case 1: return openEnds === 2 ? 100     : 10;
      default: return 0;
      }
   }

  function evaluateCell(board, x, y, who, min) {
    var size = board.length, total = 0;
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var nx = x + dx, ny = y + dy, open;
      while (inBounds(size, nx, ny) && board[nx][ny] === who) { nx += dx; ny += dy; }
      open = inBounds(size, nx, ny) && board[nx][ny] === EMPTY;
      var count = 1;
      nx = x - dx; ny = y - dy;
      while (inBounds(size, nx, ny) && board[nx][ny] === who) { count++; nx -= dx; ny -= dy; }
      var openB = inBounds(size, nx, ny) && board[nx][ny] === EMPTY;
      total += patternScore(count, (open ? 1 : 0) + (openB ? 1 : 0));
      }
    return total;
   }

  function hasNeighbor(board, x, y, radius) {
    var size = board.length, r = radius || 2;
    for (var i = -r; i <= r; i++) {
      for (var j = -r; j <= r; j++) {
        if (i === 0 && j === 0) continue;
        if (inBounds(size, x + i, y + j) && board[x + i][y + j] !== EMPTY) return true;
        }
      }
    return false;
   }

    // 回傳與石相鄰、值得考慮的空格 (radius 以 chebyshev 距離)。
  function candidateCells(board, radius) {
    var size = board.length, out = [];
    for (var x = 0; x < size; x++) {
      for (var y = 0; y < size; y++) {
        if (board[x][y] === EMPTY && hasNeighbor(board, x, y, radius || 2)) out.push([x, y]);
        }
      }
    return out;
   }

  function centerBias(x, y, size, k) {
    var c = (size - 1) / 2;
    var dist = Math.abs(x - c) + Math.abs(y - c);
    var maxDist = Math.max(1, 2 * c);
    return (k || 12) * (maxDist - dist) / maxDist;
   }

  function scoreCell(board, x, y, ai, human, min) {
    var offense = evaluateCell(board, x, y, ai, min);
    var defense = evaluateCell(board, x, y, human, min);
    return offense + defense * 0.9 + centerBias(x, y, board.length);
   }

    // 若 `who` 可立即勝出，回傳該落子點；否則 null。
  function findWinningMove(board, who, min) {
    var cands = candidateCells(board, 1);
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      board[c[0]][c[1]] = who;
      var win = winningLine(board, c[0], c[1], who, min);
      board[c[0]][c[1]] = EMPTY;
      if (win) return [c[0], c[1]];
      }
    return null;
   }

    // 貪婪最佳手 (jitter>0 加入隨機性，用於「簡單」等級)。
  function greedyMove(board, ai, human, min, jitter) {
    var cands = candidateCells(board, 2);
    if (cands.length === 0) { var c = (board.length - 1) >> 1; return [c, c]; }
    var best, bestScore = -Infinity;
    for (var i = 0; i < cands.length; i++) {
      var cell = cands[i];
      var s = scoreCell(board, cell[0], cell[1], ai, human, min);
      if (jitter && jitter > 0) s = s * (1 + (Math.random() - 0.5) * jitter);
      if (s > bestScore) { bestScore = s; best = cell; }
      }
    return best || [cands[0][0], cands[0][1]];
   }

  function staticEval(board, ai, human, min) {
    var cands = candidateCells(board, 1);
    var a = 0, h = 0;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      a += evaluateCell(board, c[0], c[1], ai, min);
      h += evaluateCell(board, c[0], c[1], human, min);
      }
    return a - h * 0.95;
   }

   // 防禦權重：對手 threat 比本方略高，避免被活叉／雙 threat 反殺。
  var DEFENSE_W = 1.2;

   // 威脅感知評估：數出該色的「活棋」（活三／活四／活叉）。
   // 活四＝下一手必殺；兩個活三（或活三＋活四）＝活叉，幾乎必勝，故權重極高。
   // 每條線僅從其「第一顆」計數，同一方向不重複加總。
  function threatScore(board, who, min) {
    min = min || 5;
    var size = board.length, four = 0, openThree = 0, three = 0, openTwo = 0;
    for (var x = 0; x < size; x++) {
      for (var y = 0; y < size; y++) {
        if (board[x][y] !== who) continue;
        for (var d = 0; d < DIRS.length; d++) {
          var dx = DIRS[d][0], dy = DIRS[d][1];
           // 僅當 (x-d) 非同色時，本顆才是該連的第一顆，避免重複計數
          var px = x - dx, py = y - dy;
          if (inBounds(size, px, py) && board[px][py] === who) continue;
          var nx = x + dx, ny = y + dy, cnt = 1;
          while (inBounds(size, nx, ny) && board[nx][ny] === who) { cnt++; nx += dx; ny += dy; }
          var endA = inBounds(size, nx, ny) && board[nx][ny] === EMPTY;
          var endB = inBounds(size, px, py) && board[px][py] === EMPTY;
          if (cnt >= min) four += 2;                  // 已成型或將成五連
          else if (cnt === 4) {
            if (endA && endB) four += 2;             // 活四：兩端皆活，下一步必殺
            else if (endA || endB) four += 1;       // 帶擋／單邊四
          } else if (cnt === 3) {
            if (endA && endB) openThree += 1;         // 活三
            else if (endA || endB) three += 1;       // 半活三
          } else if (cnt === 2) {
            if (endA && endB) openTwo += 1;          // 活雙
          }
        }
      }
    }
    var s = four * 100000 + openThree * 12000 + three * 1500 + openTwo * 150;
    if (openThree >= 2) s += 40000;                 // 活叉：兩個活三
    if (openThree + four >= 2) s += 20000;         // 活三再疊其他活 threat
    return s;
  }

  // 整盤評估：本方 threat 減去對手 threat（略高權重）。
  function evalBoard(board, ai, human, min) {
    return threatScore(board, ai, min) - threatScore(board, human, min) * DEFENSE_W;
  }

  // 威脅感知的 alpha-beta 搜索（困難等級用）。
  // depth 預設 3 手：本方→對方反擊→本方，足以看穿活叉與雙 threat。
  function minimax(board, ai, human, min, depth) {
    min = min || 5;
    depth = depth || 3;
    var BUDGET = 0x100000;                         // 節點上限，避免極端局勢失控
    var nodes = 0;
    function ordered(board, me, opp) {
      var cands = candidateCells(board, 2);
      if (cands.length === 0) return null;
      var scored = cands.map(function (c) {
        return { c: c, s: scoreCell(board, c[0], c[1], me, opp, min) };
      });
      scored.sort(function (a, b) { return b.s - a.s; });
      return scored.slice(0, 10).map(function (o) { return o.c; });
    }
    function search(board, me, opp, d, alpha, beta) {
      if (nodes++ > BUDGET) return null;           // 節點用盡：回傳 null 由上層略過
      var win = findWinningMove(board, me, min);
      if (win) return { move: win, v: 10000000 - (depth - d) }; // 越快取殺分越高
      var cands = ordered(board, me, opp);
      if (!cands) return { move: null, v: 0 };
      var best = cands[0], bv = -Infinity;
      for (var i = 0; i < cands.length; i++) {
        var cell = cands[i];
        board[cell[0]][cell[1]] = me;
        var v;
        if (d <= 1) {
          v = evalBoard(board, me, opp, min);
        } else {
          var r = search(board, opp, me, d - 1, -beta, -alpha);
          v = (r === null) ? 0 : -r.v;             // 對手節點用盡 → 中性處理
        }
        board[cell[0]][cell[1]] = EMPTY;
        if (v > bv) { bv = v; best = cell; }
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;                  // alpha-beta 剪枝
      }
      return { move: best, v: bv };
    }
    var result = search(board, ai, human, depth, -Infinity, Infinity);
    if (!result) return greedyMove(board, ai, human, min, 0); // 預算用盡：退回貪婪，保證合法落點
    return result.move;
  }

  function chooseMove(board, ai, human, min, difficulty) {
    difficulty = difficulty || "hard";
    min = min || 5;
    if (candidateCells(board, 2).length === 0) {
      var c = (board.length - 1) >> 1;
      return [c, c];
      }
    var block = findWinningMove(board, human, min); // 擋对手的殺著

    if (difficulty === "easy") {
      if (Math.random() < 0.6 && block) return block;
      return greedyMove(board, ai, human, min, 1.6);
      }
    if (difficulty === "medium") {
      var win = findWinningMove(board, ai, min);
      if (win) return win;
      if (block) return block;
      return greedyMove(board, ai, human, min, 0);
      }
      // hard
    var hw = findWinningMove(board, ai, min);
    if (hw) return hw;
    if (block) return block;
    var m = minimax(board, ai, human, min);
    return m || greedyMove(board, ai, human, min, 0);
   }

/* ---- 遊戲控制器 ---- */
  function createGame(opts) {
    opts = opts || {};
    var size = opts.size || 15;
    if (size < 5) { var e = new Error("棋盤至少需 5x5"); e.code = "TOO_SMALL"; throw e; }
    var winLength = opts.winLength || 5;
    var vsAI = opts.vsAI !== false;
    var aiPlayer = vsAI ? (opts.aiPlayer || WHITE) : null;

    var game = {
      size: size,
      winLength: winLength,
      vsAI: vsAI,
      aiPlayer: aiPlayer,
      humanPlayer: aiPlayer === BLACK ? WHITE : BLACK,
      difficulty: opts.difficulty || "hard",
      round: 1,
      board: null,
      moves: [],
      winner: null,
      winLine: null,
      turn: BLACK,
      aiThinking: false
     };

    function resetInternal() {
      game.board = emptyBoard(size);
      game.moves = [];
      game.winner = null;
      game.winLine = null;
      game.turn = BLACK;
      game.aiThinking = false;
      }

    resetInternal();

    game.reset        = function () { resetInternal(); return game; };
    game.nextRound    = function () { game.round++; resetInternal(); return game; };
    game.currentPlayer = function () { return game.turn; };
    game.isTurn       = function (p) { return !game.isOver() && game.turn === p; };
    game.isOver       = function () { return game.winner !== null; };
    game.stoneCount   = function () { return game.moves.length; };
    game.getBoard     = function () { return cloneBoard(game.board); };

    game.place = function (x, y, player) {
      if (game.isOver()) return false;
      if (!isLegalMove(game.board, x, y)) return false;
      player = player || game.turn;
      game.board[x][y] = player;
      game.moves.push({ x: x, y: y, player: player });
      var line = winningLine(game.board, x, y, player, winLength);
      if (line) {
        game.winner = player;
        game.winLine = line;
        game.turn = null;
        return true;
        }
      if (game.moves.length === size * size) {
        game.winner = "draw";
        game.turn = null;
        return true;
         }
      game.turn = opponentOf(player);
      return true;
      };

    game.aiMove = function () {
      if (game.isOver() || game.aiPlayer === null || game.turn !== game.aiPlayer) return null;
      game.aiThinking = true;
      var m = chooseMove(game.board, game.aiPlayer, game.humanPlayer, winLength, game.difficulty);
      if (!isLegalMove(game.board, m[0], m[1])) { game.aiThinking = false; return null; }
      var r = { x: m[0], y: m[1], player: game.aiPlayer };
      game.place(m[0], m[1], game.aiPlayer);
      game.aiThinking = false;
      return r;
      };

    game.undo = function () {
      if (game.moves.length === 0) return false;
      var take = 1;
      var last = game.moves[game.moves.length - 1];
      if (game.vsAI && game.moves.length >= 2 && last.player === game.aiPlayer) take = 2;
      var removed = 0;
      while (removed < take && game.moves.length > 0) {
        var m = game.moves.pop();
        game.board[m.x][m.y] = EMPTY;
        removed++;
        }
      game.winner = null;
      game.winLine = null;
      game.aiThinking = false;
      game.turn = game.moves.length === 0 ? BLACK : opponentOf(game.moves[game.moves.length - 1].player);
      return true;
      };

    game.snapshot = function () {
      return {
        board: cloneBoard(game.board),
        winner: game.winner,
        winLine: game.winLine,
        moves: game.moves.map(function (m) { return { x: m.x, y: m.y, player: m.player }; }),
        turn: game.turn
        };
     };

    return game;
   }

  Game.emptyBoard = emptyBoard;
  Game.cloneBoard = cloneBoard;
  Game.inBounds = inBounds;
  Game.isLegalMove = isLegalMove;
  Game.opponentOf = opponentOf;
  Game.countLine = countLine;
  Game.winningLine = winningLine;
  Game.patternScore = patternScore;
  Game.evaluateCell = evaluateCell;
  Game.hasNeighbor = hasNeighbor;
  Game.candidateCells = candidateCells;
  Game.centerBias = centerBias;
  Game.scoreCell = scoreCell;
  Game.findWinningMove = findWinningMove;
  Game.greedyMove = greedyMove;
  Game.staticEval = staticEval;
  Game.threatScore = threatScore;
  Game.evalBoard = evalBoard;
  Game.minimax = minimax;
  Game.chooseMove = chooseMove;
  Game.createGame = createGame;

    return Game;
 });
