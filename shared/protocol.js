/* =====================================================================
 * 線上對戰共用協定 (shared/protocol.js)
 * client / server 共用的訊息型別、常數與文案。UMD：Node + 瀏覽器雙用。
 * 依五子棋調整：無隱藏資訊，state 為完全公開盤面；動作僅 {x,y} 落子。
 * ===================================================================== */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (root) root.Protocol = api;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this),
function () {
  "use strict";

  var P = {};

  // ---- 房間狀態機 ----
  P.ROOM_STATUS = { WAITING: "waiting", PLAYING: "playing", FINISHED: "finished" };

  // ---- 終局原因與中文文案 ----
  P.GAME_OVER_REASONS = {
    "five": "五子連線，分出勝負",
    "forbidden": "黑棋觸犯禁手，判定敗北",
    "board-full": "棋盤下滿，判定和棋",
    "draw-agreed": "雙方同意和棋",
    "timeout": "走棋逾時，判定敗北",
    "forfeit": "斷線逾時未回，判定敗北",
    "resign": "認輸",
    "aborted": "對戰提前結束，不計勝負"
  };
  P.reasonText = function (reason) { return P.GAME_OVER_REASONS[reason] || "對局結束"; };

  // ---- 規則集 ----
  P.RULESETS = ["freestyle", "standard", "renju"];
  P.RULESET_TEXT = { freestyle: "自由五子棋", standard: "標準無禁五子棋", renju: "連珠（黑棋禁手）" };
  P.normalizeRuleset = function (value) { return P.RULESETS.indexOf(value) >= 0 ? value : "standard"; };

  // ---- 座位 ----
  P.SEAT_NAMES = ["玩家一", "玩家二"];
  P.SPECTATOR_NAME = "觀眾";
  P.NAME_MAX = 12;          // 顯示名稱上限（trim 後）
  P.WIN_LENGTH = 5;
  P.BOARD_SIZE = 15;

  // ---- 上行訊息白名單（client → server，未知 t 一律丟棄並回 bad-message）----
  P.CLIENT_TYPES = [
    "subscribeLobby", "join", "action", "chat", "canned",
    "drawOffer", "drawResponse", "abortRequest", "abortResponse",
    "resign", "rematch", "rematchResponse", "announcementAck"
  ];

  // ---- 欄位上限（guards 用）----
  P.LIMITS = {
    roomId: 24, playerToken: 64, joinName: 24, chatRaw: 500,
    chatText: 120, cannedId: 32, chatHistory: 50,
    announcementAck: 64
  };

  // ---- 全站公告（後台發佈，全體廣播）----
  // 下行訊息（server → client）：{ t: "announcement", id, text, at }
  // 上行回條（client → server）：{ t: "announcementAck", id }，id 為公告 uuid。

  // ---- 快速訊息白名單（含 Emoji 與嗆聲垃圾話，id 同時是 client/server 白名單）----
  P.CANNED_MESSAGES = {
    "hello": "👋 哈囉，請多指教！",
    "good-luck": "🍀 好運喔！",
    "hurry": "⏰ 快下啦～",
    "thinking-long": "🤔 讓我想想喔…",
    "nice-move": "👏 好棋！",
    "oops": "😱 啊，下錯了",
    "doomed": "😵 大勢已去了",
    "wait": "✋ 等我想一下啦",
    "thanks": "🙏 謝謝指教",
    "trap": "🪤 小心有陷阱喔",
    "good-stone": "🔥 這手妙啊！",
    "lag": "🐢 我的網路好卡…",
    "rematch": "🔁 再來一局啦！",
    "gg": "🎮 GG，打得漂亮",
    "scared": "🐔 你在怕什麼？",
    "come-on": "😈 來啊，互相傷害！",
    "trapped-you": "😏 你已經中計了",
    "winning": "😎 這局我穩了",
    "too-strong": "😳 你也太強了吧",
    "sleepy": "🥱 你想很久耶…",
    "surrender": "🏳️ 快點投降吧你",
    "focus": "🧐 專心一點啊",
    "lucky": "🤞 那只是運氣好",
    "again": "😤 不服再戰！"
  };
  P.cannedText = function (id) { return P.CANNED_MESSAGES[id] || null; };

  // ---- 錯誤碼 ----
  P.ERROR_CODES = ["room-not-found", "bad-message", "connected-elsewhere", "rate-limited"];

  // ---- Lobby ----
  P.LOBBY_HTTP_LIMIT = 20;   // GET /api/games 上限
  P.LOBBY_PUSH_LIMIT = 50;   // WS 推播上限
  P.LOBBY_DEBOUNCE_MS = 50;

  // ---- ChatMessage 建構 helper（確保欄位一致）----
  P.chatMessage = function (id, from, kind, text, name, cannedId, at) {
    var msg = { id: id, from: from, kind: kind, text: text, at: at || Date.now() };
    if (name) msg.name = name;
    if (cannedId) msg.cannedId = cannedId;
    return msg;
    };

  // 由 GameState（game.js 實例）組出下行 DTO（五子棋無隱藏資訊，完整公開）。
  P.toStateDTO = function (game) {
    var snap = game.snapshot();
    return {
      size: game.size,
      ruleset: game.ruleset,
      board: snap.board,
      moves: snap.moves,
      turn: snap.turn,                     // 1=黑 2=白，終局 null
      winner: snap.winner,                 // 1|2|"draw"|null
      winLine: snap.winLine,
      moveNumber: snap.moves.length,
      blackForbiddenWarned: !!snap.blackForbiddenWarned,
      forbidden: !!snap.forbidden,
      forbiddenType: snap.forbiddenType || null
      };
    };

  return P;
 });