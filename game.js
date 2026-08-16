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

    // 若於 (x,y) 落子形成「精準五連」（某方向剛好 min 子），回傳該連線；否則 null。
    // 黑棋長連（>min）不算勝，故採「剛好等於 min」而非 ≥。
  function winningFiveLine(board, x, y, who, min) {
    var size = board.length, min = min || 5;
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      if (countLine(board, x, y, who, dx, dy) === min) {
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

    // 依難度對應規則集：簡單→自由（freestyle）、困難→連珠（renju）、其餘→標準（standard）。
  function rulesetFor(difficulty) {
    if (difficulty === "easy") return "freestyle";
    if (difficulty === "hard") return "renju";
    return "standard";
   }
    // 依規則集決定勝負連線：
    // freestyle：黑白長連（≥min）皆算勝；renju：白棋長連算勝、黑棋僅精準五連；
    // standard：黑白皆僅精準五連（剛好 min）。
  function winLineForRules(board, x, y, who, min, ruleset) {
    if (ruleset === "freestyle") return winningLine(board, x, y, who, min);
    if (ruleset === "renju" && who === WHITE) return winningLine(board, x, y, who, min);
    return winningFiveLine(board, x, y, who, min);
   }

    /* ---- 黑棋禁手：三三・四四・長連 偵測 ----
     * 三三（雙活三）：同一手同時形成兩個以上的活三。
     * 四四（雙四）：同一手同時形成兩個以上的四（活四或衝四）。
     * 長連：黑棋連出六子以上（超過五子），不算勝，直接判禁手。
     * 先五為勝：精準五連優先於禁手（會勝即不視為禁手）；白棋不受限。
     */
  // 取得穿過指定交叉點的連續棋子列。呼叫前 board[x][y] 需已為 who。
  function contiguousCellsThrough(board, x, y, who, dx, dy) {
    var size = board.length, cells = [[x, y]], nx = x + dx, ny = y + dy;
    while (inBounds(size, nx, ny) && board[nx][ny] === who) {
      cells.push([nx, ny]); nx += dx; ny += dy;
      }
    nx = x - dx; ny = y - dy;
    while (inBounds(size, nx, ny) && board[nx][ny] === who) {
      cells.unshift([nx, ny]); nx -= dx; ny -= dy;
      }
    return cells;
   }

  function containsCell(cells, x, y) {
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][0] === x && cells[i][1] === y) return true;
      }
    return false;
   }

  // 直四的兩個成五點都必須真的能形成精準五連；靠近邊界、被阻擋或會變長連
  // 的表面四，不能當成 RIF 定義中的 Straight Four。
  function straightFourCompletions(board, cells, who, dx, dy, min) {
    var size = board.length, first = cells[0], last = cells[cells.length - 1];
    var candidates = [
      [first[0] - dx, first[1] - dy],
      [last[0] + dx, last[1] + dy]
    ];
    var out = [];
    for (var i = 0; i < candidates.length; i++) {
      var p = candidates[i];
      if (!inBounds(size, p[0], p[1]) || board[p[0]][p[1]] !== EMPTY) continue;
      board[p[0]][p[1]] = who;
      var exact = countLine(board, p[0], p[1], who, dx, dy) === min;
      board[p[0]][p[1]] = EMPTY;
      if (exact) out.push(p);
      }
    return out;
   }

  function renjuContext() {
    return { forbiddenDoubleThree: Object.create(null), active: Object.create(null) };
   }

  function boardStateKey(board) {
    var rows = [];
    for (var i = 0; i < board.length; i++) rows.push(board[i].join(""));
    return board.length + ":" + rows.join("/");
   }

  // 在方向 (dx,dy) 上，是否存在真正的 Straight Four 穿過 (x,y)。
  // 呼叫前 board[x][y] 需已為 who。
  function isOpenFourThrough(board, x, y, who, dx, dy) {
    var min = 5;
    var cells = contiguousCellsThrough(board, x, y, who, dx, dy);
    if (cells.length !== min - 1) return false;
    return straightFourCompletions(board, cells, who, dx, dy, min).length >= 2;
   }

    // 找出這一手在單一方向形成的所有「四」。四不只限於連四，也包含可補成五的跳四；
    // 以四顆既有棋子的集合去重，避免活四的兩個成五點被重複計算。
  function fourStructuresInDirection(board, x, y, who, dx, dy, min) {
    var size = board.length, out = [], seen = Object.create(null);
    for (var k = -(min - 1); k <= min - 1; k++) {
      if (k === 0) continue;
      var ex = x + dx * k, ey = y + dy * k;
      if (!inBounds(size, ex, ey) || board[ex][ey] !== EMPTY) continue;
      board[ex][ey] = who;
      if (countLine(board, ex, ey, who, dx, dy) === min) {
        var line = contiguousCellsThrough(board, ex, ey, who, dx, dy);
        if (containsCell(line, x, y)) {
          var four = [];
          for (var i = 0; i < line.length; i++) {
            if (line[i][0] !== ex || line[i][1] !== ey) four.push(line[i]);
            }
          var key = four.map(function (p) { return p[0] + "," + p[1]; }).join(";");
          if (!seen[key]) {
            seen[key] = true;
            out.push({ cells: four, completion: [ex, ey] });
            }
          }
        }
      board[ex][ey] = EMPTY;
      }
    return out;
   }

  function fourStructures(board, x, y, who, min) {
    var out = [];
    for (var d = 0; d < DIRS.length; d++) {
      var found = fourStructuresInDirection(board, x, y, who, DIRS[d][0], DIRS[d][1], min);
      for (var i = 0; i < found.length; i++) out.push(found[i]);
      }
    return out;
   }

    // 找出由 (x,y) 形成的 Three。關鍵是補四的那一子必須位於該四顆連續棋子中；
    // 因此已經存在的四，不會因為在同方向遠處再放一子而被錯算成 Three。
  function threeStructuresInDirection(board, x, y, who, dx, dy, min) {
    var size = board.length, out = [], seen = Object.create(null);
    for (var k = -(min - 1); k <= min - 1; k++) {
      if (k === 0) continue;
      var ex = x + dx * k, ey = y + dy * k;
      if (!inBounds(size, ex, ey) || board[ex][ey] !== EMPTY) continue;
      board[ex][ey] = who;
      var line = contiguousCellsThrough(board, ex, ey, who, dx, dy);
      var isThree = line.length === min - 1 && containsCell(line, x, y);
      var straight = isThree && straightFourCompletions(board, line, who, dx, dy, min).length >= 2;
      // RIF §3 的 Three 不能以同一手同時形成五連。
      if (straight && !isFive(board, ex, ey, who, min)) {
        var three = [];
        for (var i = 0; i < line.length; i++) {
          if (line[i][0] !== ex || line[i][1] !== ey) three.push(line[i]);
          }
        var key = dx + "," + dy + ":" + three.map(function (p) { return p[0] + "," + p[1]; }).join(";");
        if (!seen[key]) {
          seen[key] = { cells: three, extensions: [] };
          out.push(seen[key]);
          }
        seen[key].extensions.push([ex, ey]);
        }
      board[ex][ey] = EMPTY;
      }
    return out;
   }

  function threeStructures(board, x, y, who, min) {
    var out = [];
    for (var d = 0; d < DIRS.length; d++) {
      var found = threeStructuresInDirection(board, x, y, who, DIRS[d][0], DIRS[d][1], min);
      for (var i = 0; i < found.length; i++) out.push(found[i]);
      }
    return out;
   }

  function forbiddenDoubleThreePlaced(board, x, y, who, min, context) {
    if (who !== BLACK) return false;
    min = min || 5;
    if (isFive(board, x, y, who, min)) return false;
    if (isOverline(board, x, y, who, min)) return true;
    if (isDoubleFour(board, x, y, who, min)) return true;
    context = context || renjuContext();
    var key = boardStateKey(board) + "|" + x + "," + y + "|" + min;
    if (Object.prototype.hasOwnProperty.call(context.forbiddenDoubleThree, key)) {
      return context.forbiddenDoubleThree[key];
      }
    // 每次遞迴都多放一子，理論上不會循環；active 仍保留作為防護。
    if (context.active[key]) return false;
    context.active[key] = true;
    var threes = threeStructures(board, x, y, who, min), safeCount = 0;
    for (var i = 0; i < threes.length; i++) {
      if (hasAllowedThreeExtension(board, threes[i], who, min, context)) safeCount++;
      }
    var forbidden = threes.length > 1 && safeCount > 1;
    delete context.active[key];
    context.forbiddenDoubleThree[key] = forbidden;
    return forbidden;
   }

  function hasAllowedThreeExtension(board, three, who, min, context) {
    for (var i = 0; i < three.extensions.length; i++) {
      var p = three.extensions[i];
      board[p[0]][p[1]] = who;
      var allowed = true;
      if (who === BLACK) {
        allowed = !isOverline(board, p[0], p[1], who, min) &&
          !isDoubleFour(board, p[0], p[1], who, min) &&
          !forbiddenDoubleThreePlaced(board, p[0], p[1], who, min, context);
        }
      board[p[0]][p[1]] = EMPTY;
      if (allowed) return true;
      }
    return false;
   }

    // 在方向 (dx,dy) 上，(x,y) 落子後是否形成可合法發展的 Three。
    // 呼叫前 board[x][y] 需已為 who。
  function isOpenThree(board, x, y, who, dx, dy) {
    var min = 5, found = threeStructuresInDirection(board, x, y, who, dx, dy, min);
    var context = renjuContext();
    for (var i = 0; i < found.length; i++) {
      if (hasAllowedThreeExtension(board, found[i], who, min, context)) return true;
      }
    return false;
   }

    // (x,y) 落子後是否形成 RIF 意義下的禁手雙三。這裡不只數表面棋型，還會
    // 依 §9.3 檢查每個 Three 的合法 Straight Four 延伸，並遞迴檢查延伸所形成的雙三。
  function isDoubleOpenThree(board, x, y, who) {
    var min = 5, threes = threeStructures(board, x, y, who, min);
    if (threes.length < 2) return false;
    var context = renjuContext(), safeCount = 0;
    for (var i = 0; i < threes.length; i++) {
      if (hasAllowedThreeExtension(board, threes[i], who, min, context)) safeCount++;
      }
    return safeCount > 1;
   }

    /* ---- 長連與精準五連 ---- */
    // (x,y) 落子後是否形成「精準五連」（某方向剛好 min 子）。呼叫前 board[x][y] 需已為 who。
  function isFive(board, x, y, who, min) {
    min = min || 5;
    for (var d = 0; d < DIRS.length; d++) {
      if (countLine(board, x, y, who, DIRS[d][0], DIRS[d][1]) === min) return true;
      }
    return false;
   }
    // (x,y) 落子後是否形成「長連」（某方向超過 min 子）。呼叫前 board[x][y] 需已為 who。
  function isOverline(board, x, y, who, min) {
    min = min || 5;
    for (var d = 0; d < DIRS.length; d++) {
      if (countLine(board, x, y, who, DIRS[d][0], DIRS[d][1]) > min) return true;
      }
    return false;
   }

    /* ---- 四四（雙四）偵測 ----
     * 「四」：再加一手即可成「精準五連」的連子型（含活四與衝四）；
     *        只能湊成長連（六子以上）的「假四」不算。
     * 四四：同一手同時形成兩個以上的四。先手黑棋禁手。
     */
    // 方向 (dx,dy) 上穿過 (x,y) 的連子數是否剛好 min。呼叫前 board[x][y] 需已為 who。
  function isFiveThrough(board, x, y, who, dx, dy, min) {
    return countLine(board, x, y, who, dx, dy) === (min || 5);
   }
    // 在方向 (dx,dy) 上，(x,y) 落子後是否形成至少一個「四」（含跳四）。
    // 呼叫前 board[x][y] 需已為 who。
  function isFourThrough(board, x, y, who, dx, dy, min) {
    min = min || 5;
    return fourStructuresInDirection(board, x, y, who, dx, dy, min).length > 0;
   }
    // (x,y) 落子後是否同時形成兩個以上的四。呼叫前 board[x][y] 需已為 who。
  function isDoubleFour(board, x, y, who, min) {
    min = min || 5;
    return fourStructures(board, x, y, who, min).length >= 2;
   }

    /* ---- 禁手判定（彙整）---- */
    // 假設 board[x][y] 已為 who，回傳禁手類型；無禁手（或白棋）回 null。
    // 優先序：精準五連（勝）→ 非禁手；長連 → "overline"；四四 → "doubleFour"；三三 → "doubleThree"。
  function forbiddenReasonPlaced(board, x, y, who, min, ruleset) {
    min = min || 5;
    if (who !== BLACK) return null;
    if (ruleset === "freestyle" || ruleset === "standard") return null; // 自由／標準規則：黑棋無禁手（僅連珠有禁手）
    if (isFive(board, x, y, who, min)) return null;            // 先五為勝，不計禁手
    if (isOverline(board, x, y, who, min)) return "overline";
    if (isDoubleFour(board, x, y, who, min)) return "doubleFour";
    if (forbiddenDoubleThreePlaced(board, x, y, who, min, renjuContext())) return "doubleThree";
    return null;
   }
    // 在 (x,y) 落 who 子是否構成禁手（會勝不算禁手；白棋永不禁手）。
    // 函式會暫時落子再還原，呼叫時 (x,y) 需為空格。
  function isForbiddenMove(board, x, y, who, min, ruleset) {
    if (who !== BLACK) return false;
    if (!isLegalMove(board, x, y)) return false;
    board[x][y] = who;
    var reason = forbiddenReasonPlaced(board, x, y, who, min, ruleset);
    board[x][y] = EMPTY;
    return reason !== null;
   }
    // 回傳禁手類型字串（呼叫時 (x,y) 需為空格）；非禁手或白棋回 null。
  function forbiddenReason(board, x, y, who, min, ruleset) {
    if (who !== BLACK) return null;
    if (!isLegalMove(board, x, y)) return null;
    board[x][y] = who;
    var reason = forbiddenReasonPlaced(board, x, y, who, min, ruleset);
    board[x][y] = EMPTY;
    return reason;
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
      var nx = x + dx, ny = y + dy, open, count = 1;
      while (inBounds(size, nx, ny) && board[nx][ny] === who) { count++; nx += dx; ny += dy; }
      open = inBounds(size, nx, ny) && board[nx][ny] === EMPTY;
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

    // 候選格中排除黑棋禁手（僅連珠規則）；白棋或自由／標準規則時回傳原候選
    //（交由 place 依規則處理）；全數被禁時亦回傳原候選。
  function legalCandidates(board, who, min, radius, ruleset) {
    var cs = candidateCells(board, radius);
    if (who !== BLACK || ruleset === "freestyle" || ruleset === "standard") return cs;
    var ok = [];
    for (var i = 0; i < cs.length; i++) {
      if (!isForbiddenMove(board, cs[i][0], cs[i][1], who, min, ruleset)) ok.push(cs[i]);
      }
    return ok.length ? ok : cs;
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
  function findWinningMove(board, who, min, ruleset) {
    var cands = candidateCells(board, 1);
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      board[c[0]][c[1]] = who;
      var win = winLineForRules(board, c[0], c[1], who, min, ruleset);
      board[c[0]][c[1]] = EMPTY;
      if (win) return [c[0], c[1]];
      }
    return null;
   }

    // `who` 目前有幾個「立即取勝點」（下一手就能成五的空格）。
  function winningMoveCount(board, who, min, ruleset) {
    var cands = candidateCells(board, 1), n = 0;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      board[c[0]][c[1]] = who;
      var win = winLineForRules(board, c[0], c[1], who, min, ruleset);
      board[c[0]][c[1]] = EMPTY;
      if (win) n++;
      }
    return n;
   }

    /* ---- 必殺威脅（活四／雙四）----
     * 「必殺點」＝下在該處後，會同時出現兩個以上的立即取勝點，對手只能擋一個。
     * 此定義同時涵蓋連續活四 ●●●● 與跳四 ●●_●● 等斷點棋型，
     * 且會依規則集排除黑棋禁手（禁手手不算真威脅）。
     */
  function unstoppableMoves(board, who, min, ruleset) {
    var cands = candidateCells(board, 2), out = [];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (isForbiddenMove(board, c[0], c[1], who, min, ruleset)) continue;
      board[c[0]][c[1]] = who;
      var already = winLineForRules(board, c[0], c[1], who, min, ruleset);
      var n = already ? 0 : winningMoveCount(board, who, min, ruleset);
      board[c[0]][c[1]] = EMPTY;
      if (n >= 2) out.push([c[0], c[1]]);
      }
    return out;
   }

    // 找出能化解對手所有必殺威脅的落點；若無解（已成死局）回傳 null。
    // 於多個可行解中取 scoreCell 最高者，兼顧防守與己方發展。
  function blockThreatMove(board, ai, human, min, ruleset) {
    if (unstoppableMoves(board, human, min, ruleset).length === 0) return null;
    var cands = candidateCells(board, 2), best = null, bestScore = -Infinity;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (isForbiddenMove(board, c[0], c[1], ai, min, ruleset)) continue;
      board[c[0]][c[1]] = ai;
      var safe = winningMoveCount(board, human, min, ruleset) === 0 &&
                 unstoppableMoves(board, human, min, ruleset).length === 0;
      var s = safe ? scoreCell(board, c[0], c[1], ai, human, min) : 0;
      board[c[0]][c[1]] = EMPTY;
      if (safe && s > bestScore) { bestScore = s; best = c; }
      }
    return best;
   }

    // 貪婪最佳手 (jitter>0 加入隨機性，用於「簡單」等級)。
  function greedyMove(board, ai, human, min, jitter, ruleset) {
    var cands = legalCandidates(board, ai, min, 2, ruleset);
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

   // 只數「連續」棋型的威脅統計（min ≠ 5 時的通用備援）。
   // 每條線僅從其「第一顆」計數，同一方向不重複加總。
  function threatCountsRuns(board, who, min) {
    var size = board.length, c = { four: 0, openThree: 0, three: 0, openTwo: 0 };
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
          if (cnt >= min) c.four += 2;                 // 已成型或將成五連
          else if (cnt === min - 1) {
            if (endA && endB) c.four += 2;            // 活四：兩端皆活，下一步必殺
            else if (endA || endB) c.four += 1;      // 帶擋／單邊四
          } else if (cnt === min - 2) {
            if (endA && endB) c.openThree += 1;        // 活三
            else if (endA || endB) c.three += 1;      // 半活三
          } else if (cnt === min - 3) {
            if (endA && endB) c.openTwo += 1;         // 活雙
          }
        }
      }
    }
    return c;
  }

   /* ---- 樣式式（pattern）威脅統計 ----
    * 舊版僅辨識「連續」棋子，跳三 ●●_● 這類帶斷點的棋型會被嚴重低估
    *（●●● 記 12000 分，●●_● 卻只有 150 分），導致 AI 漏擋。
    * 以下改為整條線做樣式比對，連續型與跳型一併辨識。
    * 1＝該色、2＝對手或牆、0＝空格；比對到的棋子會被標記消耗，避免同一批子重複計分。
    */
  var PATTERN_GROUPS = [
    { key: "four",      res: [/11111/, /011110/, /011112/, /211110/, /10111/, /11011/, /11101/] },
    { key: "openThree", res: [/011100/, /001110/, /011010/, /010110/] },
    { key: "three",     res: [/001112/, /211100/, /010112/, /211010/, /011012/, /210110/, /10011/, /11001/, /10101/] },
    { key: "openTwo",   res: [/001100/, /001010/, /010100/] }
  ];

   // 取出棋盤所有長度 >= min 的線（橫、直、兩對角），每條為格值陣列。
  function boardLines(board, min) {
    var n = board.length, lines = [], x, y, s, a, b, y1, y2;
    for (x = 0; x < n; x++) lines.push(board[x].slice());
    for (y = 0; y < n; y++) { var col = []; for (x = 0; x < n; x++) col.push(board[x][y]); lines.push(col); }
    for (s = -(n - 1); s < n; s++) {
      a = []; b = [];
      for (x = 0; x < n; x++) {
        y1 = x - s; y2 = s - x + n - 1;
        if (y1 >= 0 && y1 < n) a.push(board[x][y1]);
        if (y2 >= 0 && y2 < n) b.push(board[x][y2]);
      }
      if (a.length >= min) lines.push(a);
      if (b.length >= min) lines.push(b);
    }
    return lines;
  }

   // 以樣式比對統計 who 的威脅棋型（僅適用 min === 5）。
  function threatCountsPattern(board, who) {
    var opp = opponentOf(who), c = { four: 0, openThree: 0, three: 0, openTwo: 0 };
    var lines = boardLines(board, 5);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], str = "2";                 // 頭尾補牆，讓邊界等同被擋
      for (var j = 0; j < line.length; j++) str += line[j] === who ? "1" : (line[j] === opp ? "2" : "0");
      str += "2";
      for (var g = 0; g < PATTERN_GROUPS.length; g++) {
        var grp = PATTERN_GROUPS[g];
        for (var r = 0; r < grp.res.length; r++) {
          var m;
          while ((m = str.match(grp.res[r])) !== null) {
            c[grp.key]++;
             // 消耗已計分的棋子（標記為 2），避免同一批子被較低階棋型重複計算
            str = str.slice(0, m.index) + m[0].replace(/1/g, "2") + str.slice(m.index + m[0].length);
          }
        }
      }
    }
    return c;
  }

   // 威脅感知評估：數出該色的「活棋」（活三／活四／活叉），含跳三、跳四等斷點棋型。
   // 活四＝下一手必殺；兩個活三（或活三＋活四）＝活叉，幾乎必勝，故權重極高。
  function threatScore(board, who, min) {
    min = min || 5;
    var c = min === 5 ? threatCountsPattern(board, who) : threatCountsRuns(board, who, min);
    var s = c.four * 100000 + c.openThree * 12000 + c.three * 1500 + c.openTwo * 150;
    if (c.openThree >= 2) s += 40000;                // 活叉：兩個活三
    if (c.openThree + c.four >= 2) s += 20000;      // 活三再疊其他活 threat
    return s;
  }

  // 整盤評估：本方 threat 減去對手 threat（略高權重）。
  function evalBoard(board, ai, human, min) {
    return threatScore(board, ai, min) - threatScore(board, human, min) * DEFENSE_W;
  }

  // 威脅感知的 alpha-beta 搜索（困難等級用）。
  // depth 預設 3 手：本方→對方反擊→本方，足以看穿活叉與雙 threat。
  function minimax(board, ai, human, min, depth, ruleset) {
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
      var win = findWinningMove(board, me, min, ruleset);
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
    if (!result) return greedyMove(board, ai, human, min, 0, ruleset); // 預算用盡：退回貪婪，保證合法落點
    return result.move;
  }

  /* ---- 連續衝四殺（VCF, Victory by Continuous Fours）----
   * 只搜尋「衝四」（落子後出現 ≥1 個立即取勝點）這種迫使對手回擋的著手，
   * 分支極窄（對手回擋點通常唯一），可搜得很深，是五子棋引擎最關鍵的技術。
   * 以下保證「致勝」為真：每個對手節點都檢查對手是否已有立即成五，
   * 並在對手回擋後出現「反衝四」（對手也形成取勝點）時放棄該分支。
   */
  var VCF_DEPTH  = 10;      // 連四殺最大手數（分支近乎線性，可搜深）
  var VCF_BUDGET = 12000;   // 節點上限，避免極端局勢失控

  // 產生「衝四點」：落子後會出現 ≥1 個立即取勝點的著手。
  // 以 evaluateCell≥10000（即形成四或更強棋型）快篩，再以 winningMoveCount 確認，
  // 大幅縮減需逐一驗證的候選，讓 VCF 深搜保持輕快。排除黑棋禁手（連珠規則）。
  function fourMoves(board, who, min, ruleset) {
    var cands = candidateCells(board, 2), out = [];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (evaluateCell(board, c[0], c[1], who, min) < 10000) continue;  // 快篩：四以上才可能成衝四
      if (isForbiddenMove(board, c[0], c[1], who, min, ruleset)) continue;
      board[c[0]][c[1]] = who;
      var n = winningMoveCount(board, who, min, ruleset);
      board[c[0]][c[1]] = EMPTY;
      if (n >= 1) out.push([c[0], c[1]]);
      }
    return out;
    }

  // 連續衝四殺：回傳第一手致勝著手；若無強制勝回 null。
  // 預算用盡回 null（交由上層退回其他策略），保證不回傳非致勝著手。
  function vcf(board, ai, human, min, ruleset, depth, budget) {
    min = min || 5;
    depth = depth || VCF_DEPTH;
    budget = budget || { n: 0, max: VCF_BUDGET };
    function solve(d) {
      if (budget.n++ > budget.max) return null;
      var win = findWinningMove(board, ai, min, ruleset);     // 我方立即成五
      if (win) return win;
      if (d <= 0) return null;
      var fours = fourMoves(board, ai, min, ruleset);
      for (var i = 0; i < fours.length; i++) {
        var f = fours[i];
        board[f[0]][f[1]] = ai;
        if (findWinningMove(board, human, min, ruleset)) {    // 對手可立即成五 → 此衝四被反先
          board[f[0]][f[1]] = EMPTY; continue;
          }
        var n = winningMoveCount(board, ai, min, ruleset);
        if (n >= 2) { board[f[0]][f[1]] = EMPTY; return f; }  // 雙四／活四：對手擋不勝擋
        var wp = findWinningMove(board, ai, min, ruleset);    // 唯一取勝點：對手必須回擋
        board[wp[0]][wp[1]] = human;
        // 回擋後若對手反成衝四（也出現取勝點）→ 攻勢被反先，放棄；否則繼續連四
        var ok = (winningMoveCount(board, human, min, ruleset) === 0) && !!solve(d - 1);
        board[wp[0]][wp[1]] = EMPTY;
        board[f[0]][f[1]] = EMPTY;
        if (ok) return f;
        }
      return null;
      }
    return solve(depth);
    }

  // 防守：對手有連續衝四殺時，找出能破壞它的著手。
  // 逐一嘗試我方高分候選點，若落子後對手不再有 VCF（且無立即成五）即為有效防守；
  // 於有效防守中取 scoreCell 最高者。僅在對手具備衝四點時才啟動，控制成本。
  function defendVcf(board, ai, human, min, ruleset) {
    if (fourMoves(board, human, min, ruleset).length === 0) return null;   // 對手無衝四點 → 無 VCF
    if (!vcf(board, human, ai, min, ruleset)) return null;                 // 對手確無連四殺 → 不需防守
    var cands = candidateCells(board, 2), best = null, bestScore = -Infinity;
    cands.sort(function (a, b) { return scoreCell(board, b[0], b[1], ai, human, min) - scoreCell(board, a[0], a[1], ai, human, min); });
    var limit = Math.min(cands.length, 14);
    for (var i = 0; i < limit; i++) {
      var c = cands[i];
      if (isForbiddenMove(board, c[0], c[1], ai, min, ruleset)) continue;
      board[c[0]][c[1]] = ai;
      var oppWin = findWinningMove(board, human, min, ruleset);
      var stillVcf = oppWin ? true : !!vcf(board, human, ai, min, ruleset);
      board[c[0]][c[1]] = EMPTY;
      if (stillVcf) continue;
      var s = scoreCell(board, c[0], c[1], ai, human, min);
      if (s > bestScore) { bestScore = s; best = c; }
      }
    return best;
    }

  function chooseMove(board, ai, human, min, difficulty) {
    difficulty = difficulty || "hard";
    min = min || 5;
    var ruleset = rulesetFor(difficulty);   // easy→自由、hard→連珠、其餘→標準
    if (candidateCells(board, 2).length === 0) {
      var c = (board.length - 1) >> 1;
      return [c, c];
      }
    var block = findWinningMove(board, human, min, ruleset); // 擋对手的殺著

    if (difficulty === "easy") {
      if (Math.random() < 0.6 && block && !isForbiddenMove(board, block[0], block[1], ai, min, ruleset)) return block;
      return greedyMove(board, ai, human, min, 1.6, ruleset);
      }
    if (difficulty === "medium") {
      var win = findWinningMove(board, ai, min, ruleset);
      if (win) return win;
      if (block && !isForbiddenMove(board, block[0], block[1], ai, min, ruleset)) return block;
      return greedyMove(board, ai, human, min, 0, ruleset);
      }
      // hard
    var hw = findWinningMove(board, ai, min, ruleset);
    if (hw) return hw;
    if (block && !isForbiddenMove(board, block[0], block[1], ai, min, ruleset)) return block;
      // 己方可先造出必殺威脅（活四／雙四）→ 主動搶先，不必被動防守
    var kills = unstoppableMoves(board, ai, min, ruleset);
    if (kills.length) {
      var kbest = kills[0], kscore = -Infinity;
      for (var ki = 0; ki < kills.length; ki++) {
        var ks = scoreCell(board, kills[ki][0], kills[ki][1], ai, human, min);
        if (ks > kscore) { kscore = ks; kbest = kills[ki]; }
        }
      return kbest;
      }
      // 進攻：連續衝四殺（VCF）— 深度搜索強制連四取勝（活四／雙四以外的多手必殺）
    var vwin = vcf(board, ai, human, min, ruleset);
    if (vwin && !isForbiddenMove(board, vwin[0], vwin[1], ai, min, ruleset)) return vwin;
      // 對手下一手可造出必殺威脅 → 明確攔截（minimax 的模糊分數常會漏擋）
    var def = blockThreatMove(board, ai, human, min, ruleset);
    if (def) return def;
      // 對手有連續衝四殺（VCF）→ 必須破壞其強制勝序列
    var dv = defendVcf(board, ai, human, min, ruleset);
    if (dv && !isForbiddenMove(board, dv[0], dv[1], ai, min, ruleset)) return dv;
    var m = minimax(board, ai, human, min, 3, ruleset);
    if (m && ai === BLACK && isForbiddenMove(board, m[0], m[1], ai, min, ruleset)) m = greedyMove(board, ai, human, min, 0, ruleset);
    return m || greedyMove(board, ai, human, min, 0, ruleset);
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
      aiThinking: false,
      blackForbiddenWarned: false, // 黑棋已因禁手被警告過（當局再犯判負）
      forbidden: false,            // 當局是否因黑棋禁手判負
      forbiddenType: null,         // 禁手類型："overline"|"doubleFour"|"doubleThree"
      forbiddenWarn: null          // 首犯退回的提示 {x,y,type}（供 UI 顯示）
     };

    function resetInternal() {
      game.board = emptyBoard(size);
      game.moves = [];
      game.winner = null;
      game.winLine = null;
      game.turn = BLACK;
      game.aiThinking = false;
      game.blackForbiddenWarned = false;
      game.forbidden = false;
      game.forbiddenType = null;
      game.forbiddenWarn = null;
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
      // 先五為勝：依難度規則集判勝——
      // 自由（簡單）黑白長連皆勝；連珠（困難）白棋長連勝、黑棋僅精準五連；
      // 標準（中等）黑白皆僅精準五連（長連不算勝）。黑棋禁手僅在連珠規則下適用。
      var ruleset = rulesetFor(game.difficulty);
      var line = winLineForRules(game.board, x, y, player, winLength, ruleset);
      if (line) {
        game.winner = player;
        game.winLine = line;
        game.turn = null;
        return true;
        }
      // 黑棋禁手：長連／四四／三三（僅連珠規則；五連勝利優先；白棋不受限）。
      if (player === BLACK) {
        var reason = forbiddenReasonPlaced(game.board, x, y, BLACK, winLength, ruleset);
        if (reason) {
          if (game.blackForbiddenWarned) {
            // 當局再犯 → 黑棋直接判負（保留此手以顯示犯規位置）
            game.winner = opponentOf(BLACK);
            game.winLine = null;
            game.forbidden = true;
            game.forbiddenType = reason;
            game.turn = null;
            return true;
            }
          // 首犯 → 給予一次退回機會：撤銷此手，警告後重下
          game.board[x][y] = EMPTY;
          game.moves.pop();
          game.blackForbiddenWarned = true;
          game.forbiddenWarn = { x: x, y: y, type: reason };
          return false;
          }
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
      if (!m || !isLegalMove(game.board, m[0], m[1])) { game.aiThinking = false; return null; }
      var ok = game.place(m[0], m[1], game.aiPlayer);
      if (!ok) {
        // 落子被退回（黑棋禁手首犯）：清掉 UI 提示並重選避開禁手的一手。
        if (game.forbiddenWarn) game.forbiddenWarn = null;
        m = chooseMove(game.board, game.aiPlayer, game.humanPlayer, winLength, game.difficulty);
        if (m && isLegalMove(game.board, m[0], m[1])) ok = game.place(m[0], m[1], game.aiPlayer);
        }
      game.aiThinking = false;
      if (!ok) return null;
      return { x: m[0], y: m[1], player: game.aiPlayer };
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
      game.forbidden = false;
      game.forbiddenType = null;
      game.forbiddenWarn = null;
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
        turn: game.turn,
        blackForbiddenWarned: game.blackForbiddenWarned,
        forbidden: game.forbidden,
        forbiddenType: game.forbiddenType
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
  Game.isOpenFourThrough = isOpenFourThrough;
  Game.isOpenThree = isOpenThree;
  Game.isDoubleOpenThree = isDoubleOpenThree;
  Game.isFive = isFive;
  Game.isOverline = isOverline;
  Game.isFiveThrough = isFiveThrough;
  Game.isFourThrough = isFourThrough;
  Game.isDoubleFour = isDoubleFour;
  Game.winningFiveLine = winningFiveLine;
  Game.winLineForRules = winLineForRules;
  Game.rulesetFor = rulesetFor;
  Game.forbiddenReasonPlaced = forbiddenReasonPlaced;
  Game.forbiddenReason = forbiddenReason;
  Game.isForbiddenMove = isForbiddenMove;
  Game.patternScore = patternScore;
  Game.evaluateCell = evaluateCell;
  Game.hasNeighbor = hasNeighbor;
  Game.candidateCells = candidateCells;
  Game.legalCandidates = legalCandidates;
  Game.centerBias = centerBias;
  Game.scoreCell = scoreCell;
  Game.findWinningMove = findWinningMove;
  Game.winningMoveCount = winningMoveCount;
  Game.unstoppableMoves = unstoppableMoves;
  Game.blockThreatMove = blockThreatMove;
  Game.fourMoves = fourMoves;
  Game.vcf = vcf;
  Game.defendVcf = defendVcf;
  Game.boardLines = boardLines;
  Game.greedyMove = greedyMove;
  Game.staticEval = staticEval;
  Game.threatScore = threatScore;
  Game.evalBoard = evalBoard;
  Game.minimax = minimax;
  Game.chooseMove = chooseMove;
  Game.createGame = createGame;

    return Game;
 });
