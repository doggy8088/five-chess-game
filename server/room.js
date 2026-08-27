"use strict";
/* 房間本體：坐席認領、回合鐘三態、evaluate 惰性判定、重啟救援、
   和棋/提前結束/認輸/再來一局協商、聊天（清洗/限速/canned/50 則尾巴）、presence 廣播。
   鐵則：計時以 deadline 時間戳惰性判定，setTimeout 只做 nudge 且 .unref()；
   斷線不等於離開，座位憑 playerToken 認領。 */

var Game = require("../game.js");
var Protocol = require("../shared/protocol.js");
var config = require("./config.js");
var ids = require("./ids.js");

var ROOM_STATUS = Protocol.ROOM_STATUS;

function now() { return Date.now(); }

function sanitizeName(raw, fallback) {
  var name = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  if (!name) return fallback;
  return Array.from(name).slice(0, Protocol.NAME_MAX).join("");
}

function sanitizeChatText(raw) {
  var text = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text) return null;
  return Array.from(text).slice(0, Protocol.LIMITS.chatText).join("");
}

class Room {
  /* ---- 建立 / 還原 ---- */

  // opts: { roomId?, name, ruleset }
  static create(opts) {
    var room = new Room();
    room.roomId = opts.roomId || ids.newRoomId();
    room.ruleset = Protocol.normalizeRuleset(opts.ruleset);
    room.size = Protocol.BOARD_SIZE;
    room.status = ROOM_STATUS.WAITING;
    room.blackSeat = 0;                       // 建立者先手執黑
    room.seats = [{ token: ids.newPlayerToken(), name: sanitizeName(opts.name, Protocol.SEAT_NAMES[0]) }, null];
    room.game = Game.createGame({ size: room.size, ruleset: room.ruleset, vsAI: false });
    room.turn = { deadlineAt: null, pausedRemainingMs: null, graceDeadlineAt: null };
    room.negotiation = { draw: null, abort: null, rematch: null };
    room.chat = [];
    room.result = null;
    room.createdAt = now();
    room.updatedAt = now();
    room.expireAt = now() + config.STALE_TTL_MS;
    room._initRuntime();
    return room;
  }

  // doc: RoomDoc（store 載入）。含重啟救援：停機期間過期的期限絕不溯及判負。
  static fromDoc(doc) {
    var room = new Room();
    room.roomId = doc.roomId;
    room.ruleset = Protocol.normalizeRuleset(doc.ruleset || "standard");
    room.size = doc.size || Protocol.BOARD_SIZE;
    room.status = doc.status;
    room.blackSeat = doc.blackSeat === 1 ? 1 : 0;
    room.seats = [doc.seats[0] ? { token: doc.seats[0].token, name: doc.seats[0].name } : null,
                  doc.seats[1] ? { token: doc.seats[1].token, name: doc.seats[1].name } : null];
    var state = doc.stateJson || {};
    room.game = Game.fromMoves(
      { size: room.size, ruleset: room.ruleset, blackForbiddenWarned: state.blackForbiddenWarned },
      state.moves || []);
    // fromMoves 可能失敗（資料不一致）：退回空局避免 crash
    if (!room.game) room.game = Game.createGame({ size: room.size, ruleset: room.ruleset, vsAI: false });
    room.turn = {
      deadlineAt: doc.turn && doc.turn.deadlineAt || null,
      pausedRemainingMs: doc.turn && doc.turn.pausedRemainingMs || null,
      graceDeadlineAt: doc.turn && doc.turn.graceDeadlineAt || null
    };
    room.negotiation = doc.negotiation || { draw: null, abort: null, rematch: null };
    room.chat = Array.isArray(doc.chatJson) ? doc.chatJson.slice(-Protocol.LIMITS.chatHistory) : [];
    room.result = doc.result || null;
    room.createdAt = doc.createdAt || now();
    room.updatedAt = doc.updatedAt || now();
    room.expireAt = doc.expireAt || now() + config.STALE_TTL_MS;

    room._initRuntime();
    if (room.status === ROOM_STATUS.PLAYING) room._restartRescue();
    return room;
  }

  _initRuntime() {
    this.seatSockets = [null, null];          // socketId per seat
    this.spectators = new Map();              // socketId -> {name}
    this.chatLimits = new Map();              // socketId -> number[] (timestamps)
    this.pendingSeq = new Map();              // socketId -> last seq echo
    this._nudgeTimer = null;
  }

  // 停機救援（§4.5）：正在對局——行動鐘轉為「暫停 + 全新寬限窗」；原本在寬限——寬限重算。
  _restartRescue() {
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) return;
    var t = this.turn;
    if (t.graceDeadlineAt && t.graceDeadlineAt > now()) {
      t.graceDeadlineAt = now() + config.GRACE_MS;
    } else if (t.deadlineAt || t.pausedRemainingMs) {
      var remaining = t.pausedRemainingMs != null
        ? t.pausedRemainingMs
        : Math.max(t.deadlineAt - now(), 0);
      t.pausedRemainingMs = Math.max(remaining, 10_000); // 至少剩 10 秒可思考
      t.deadlineAt = null;
      t.graceDeadlineAt = now() + config.GRACE_MS;
    }
    this._touch();
  }

  /* ================= 序列化 ================= */

  toDoc() {
    var snap = this.game.snapshot();
    return {
      version: 1,
      roomId: this.roomId,
      status: this.status,
      ruleset: this.ruleset,
      size: this.size,
      blackSeat: this.blackSeat,
      seats: this.seats,
      stateJson: {
        size: this.size,
        ruleset: this.ruleset,
        moves: snap.moves,
        blackForbiddenWarned: !!snap.blackForbiddenWarned
      },
      turn: this.turn,
      negotiation: this.negotiation,
      chatJson: this.chat.slice(-Protocol.LIMITS.chatHistory),
      result: this.result,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      expireAt: this.expireAt
    };
  }

  /* ================= 座位 ================= */

  seatName(seat) {
    return seat === 0 || seat === 1 ? (this.seats[seat] ? this.seats[seat].name : Protocol.SEAT_NAMES[seat]) : null;
  }

  seatOfToken(token) {
    if (!token) return null;
    for (var s = 0; s < 2; s++) {
      if (this.seats[s] && this.seats[s].token === token) return s;
    }
    return null;
  }

  // 回傳 {seat: 0|1|null, kickedSocketId?, name}
  assignSeat(socketId, msg) {
    var token = msg.playerToken || null;
    var wantSpectate = !!msg.spectate;
    var name = sanitizeName(msg.name, null);

    // 1. 帶 token 且符合 seat 0/1 → 直接認領（即使帶 spectate 也不推去觀眾）
    var seat = this.seatOfToken(token);
    if (seat !== null) {
      var kicked = this.seatSockets[seat] && this.seatSockets[seat] !== socketId ? this.seatSockets[seat] : null;
      this.seatSockets[seat] = socketId;
      this.seats[seat].connected = true;
      return { seat: seat, kickedSocketId: kicked, claimed: true };
    }

    // 2. seat 1 空著且未指定 spectate → 遞補
    if (!wantSpectate && this.status !== ROOM_STATUS.FINISHED && this.seats[1] === null) {
      var seatName = sanitizeName(msg.name, Protocol.SEAT_NAMES[1]);
      this.seats[1] = { token: ids.newPlayerToken(), name: seatName, connected: true };
      this.seatSockets[1] = socketId;
      this._fillSeat1();
      return { seat: 1, kickedSocketId: null, claimed: true };
    }

    // 3. 其餘 → 觀眾
    var spectName = sanitizeName(msg.name, Protocol.SPECTATOR_NAME);
    this.spectators.set(socketId, { name: spectName });
    return { seat: null, kickedSocketId: null, claimed: false };
  }

  // seat 1 遞補：waiting → playing，啟動回合鐘，廣播 state
  _fillSeat1() {
    if (this.status === ROOM_STATUS.WAITING) {
      this.status = ROOM_STATUS.PLAYING;
      this._startTurnClock();
      this._touch();
      // 對手遞補入座：主動廣播完整快照，等待方直接開打（§9.3）
      this._broadcast({
        t: "state",
        roomStatus: this.status,
        blackSeat: this.blackSeat,
        state: Protocol.toStateDTO(this.game),
        deadline: this.deadlineDTO()
      });
    }
  }

  disconnect(socketId) {
    for (var s = 0; s < 2; s++) {
      if (this.seatSockets[s] === socketId) {
        this.seatSockets[s] = null;
        if (this.seats[s]) this.seats[s].connected = false;
      }
    }
    this.spectators.delete(socketId);
    this.chatLimits.delete(socketId);
    // 輪到誰走誰斷線 → 鐘暫停 + 開寬限窗（§4.2）
    this._pauseClockIfTheirTurn();
    this.evaluate();
    this._touch();
  }

  _pauseClockIfTheirTurn() {
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) return;
    var turnSeat = this._turnSeat();
    if (turnSeat === null) return;
    var t = this.turn;
    var connected = !!(this.seats[turnSeat] && this.seats[turnSeat].connected);
    if (!connected && t.deadlineAt) {
      t.pausedRemainingMs = Math.max(t.deadlineAt - now(), 0);
      t.deadlineAt = null;
      t.graceDeadlineAt = now() + config.GRACE_MS;
      this._broadcastDeadline();
    }
  }

  _turnSeat() {
    // 回傳「該行動的座位」；無法判定回 null
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) return null;
    var turnColor = this.game.currentPlayer();
    if (turnColor !== Game.BLACK && turnColor !== Game.WHITE) return null;
    return turnColor === Game.BLACK ? this.blackSeat : 1 - this.blackSeat;
  }

  /* ================= 回合鐘（§4）================= */

  // 開始新手回合：輪到的人線上 → deadline；離線 → 鐘暫停 + 開寬限
  _startTurnClock() {
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) return;
    var turnSeat = this._turnSeat();
    var t = this.turn;
    var online = turnSeat !== null && !!(this.seats[turnSeat] && this.seats[turnSeat].connected);
    if (online) {
      t.deadlineAt = now() + config.TURN_MS;
      t.pausedRemainingMs = null;
      t.graceDeadlineAt = null;
    } else {
      t.deadlineAt = null;
      t.pausedRemainingMs = config.TURN_MS;
      t.graceDeadlineAt = now() + config.GRACE_MS;
    }
    this._broadcastDeadline();
    this._scheduleNudge();
  }

  // 寬限內重連：恢復 deadline
  _resumeClock(seat) {
    var t = this.turn;
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) return;
    if (this._turnSeat() !== seat) return;
    if (t.graceDeadlineAt && t.pausedRemainingMs != null) {
      t.deadlineAt = now() + t.pausedRemainingMs;
      t.pausedRemainingMs = null;
      t.graceDeadlineAt = null;
      this._broadcastDeadline();
      this._scheduleNudge();
    }
  }

  // 惰性判定：寬限逾期 → forfeit；行動鐘逾期 → timeout
  evaluate() {
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) return;
    var t = this.turn, nowMs = now();
    if (t.graceDeadlineAt && nowMs >= t.graceDeadlineAt) {
      var turnSeat = this._turnSeat();
      this.finish("forfeit", turnSeat === null ? null : 1 - turnSeat);
      return;
    }
    if (t.deadlineAt && nowMs >= t.deadlineAt) {
      var seat2 = this._turnSeat();
      this.finish("timeout", seat2 === null ? null : 1 - seat2);
      return;
    }
    this._scheduleNudge();
  }

  _scheduleNudge() {
    if (this._nudgeTimer) { clearTimeout(this._nudgeTimer); this._nudgeTimer = null; }
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) return;
    var t = this.turn;
    var candidates = [];
    if (t.deadlineAt) candidates.push(t.deadlineAt);
    if (t.graceDeadlineAt) candidates.push(t.graceDeadlineAt);
    if (!candidates.length) return;
    var nextAt = Math.min.apply(null, candidates) + 20;
    var self = this;
    this._nudgeTimer = setTimeout(function () {
      self._nudgeTimer = null;
      self.evaluate();
    }, Math.max(nextAt - now(), 1));
    this._nudgeTimer.unref();
  }

  deadlineDTO() {
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) return null;
    var t = this.turn;
    var seat = this._turnSeat();
    if (seat === null) return null;
    return {
      seat: seat,
      at: t.deadlineAt || null,
      pausedRemainingMs: t.pausedRemainingMs != null ? t.pausedRemainingMs : null,
      graceAt: t.graceDeadlineAt || null,
      serverNow: now()
    };
  }

  presenceDTO() {
    var self = this;
    function seatPresence(s) {
      if (!self.seats[s]) return { name: "等待中", connected: false };
      var connected = self.seats[s].connected;
      var out = { name: self.seats[s].name, connected: connected };
      var turnSeat = self._turnSeat();
      if (!connected && turnSeat === s && self.turn.graceDeadlineAt && self.status === ROOM_STATUS.PLAYING && !self.game.isOver()) {
        out.graceDeadlineAt = self.turn.graceDeadlineAt;
      }
      return out;
    }
    var spectatorList = [];
    this.spectators.forEach(function (info) { spectatorList.push({ name: info.name }); });
    return { seats: [seatPresence(0), seatPresence(1)], spectators: spectatorList.length, spectatorList: spectatorList };
  }

  /* ================= 訊息處理 ================= */

  // 處理 join；回傳 joined payload（由 index.js 送出）
  join(socketId, msg) {
    this.evaluate();
    var assigned = this.assignSeat(socketId, msg);
    if (assigned.kickedSocketId) {
      this.emitSend(assigned.kickedSocketId, { t: "error", code: "connected-elsewhere", message: "你已在其他視窗加入，此連線將中斷" });
      this.emitClose(assigned.kickedSocketId, 4000, "connected-elsewhere");
      this.seatSockets[assigned.seat] = socketId;
      this.spectators.delete(assigned.kickedSocketId);
   }
    // token 認領成功 → 恢復鐘
    if (assigned.seat !== null) this._resumeClock(assigned.seat);

    var payload = {
      t: "joined",
      roomId: this.roomId,
      seat: assigned.seat,
      roomStatus: this.status,
      blackSeat: this.blackSeat,
      state: Protocol.toStateDTO(this.game),
      deadline: this.deadlineDTO(),
      chat: this.chat.slice(-Protocol.LIMITS.chatHistory),
      presence: this.presenceDTO(),
      gameOver: this.result
    };
    if (assigned.seat !== null) payload.playerToken = this.seats[assigned.seat].token;

    this._touch();
    this.emitSend(socketId, payload);
    this.emitPresence();
    this.emitActivity();
    return payload;
  }

  handleAction(socketId, seat, msg) {
    this.evaluate();
    if (seat === null || seat === undefined) { this.emitInvalid(socketId, msg.seq, "觀戰模式無法進行此操作"); return; }
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) { this.emitInvalid(socketId, msg.seq, "對局已結束"); return; }
    if (this._turnSeat() !== seat) { this.emitInvalid(socketId, msg.seq, "還沒輪到你"); return; }

    var playerColor = seat === this.blackSeat ? Game.BLACK : Game.WHITE;
    var check = this.game.validateMove(msg.action.x, msg.action.y, playerColor);
    if (!check.ok) {
      this.emitInvalid(socketId, msg.seq, check.message, check.forbiddenWarn ? "forbidden-warn" : null, check.forbiddenWarn);
      return;
    }

    // 黑棋禁手「再犯判負」：直接套用該手並判負
    var applied = this.game.place(msg.action.x, msg.action.y, playerColor);
    if (!applied) { this.emitInvalid(socketId, msg.seq, "該位置已有棋子"); return; }

    this.negotiation.draw = null;
    this.negotiation.abort = null;
    this._touch();

    if (this.game.isOver()) {
      var reason = this._reasonFromGame();
      var winnerSeat = this._winnerSeatFromGame();
      this.finish(reason, winnerSeat);
    } else {
      this._startTurnClock();
    }

    var payload = {
      t: "actionApplied",
      by: seat,
      action: { x: msg.action.x, y: msg.action.y },
      state: Protocol.toStateDTO(this.game),
      deadline: this.deadlineDTO()
    };
    var self = this;
    this.seatSockets.forEach(function (sid, s) {
      if (!sid) return;
      var p = payload;
      if (s === seat) p = Object.assign({}, payload, { seq: msg.seq });
      self.emitSend(sid, p);
    });
    this.spectators.forEach(function (_info, sid) {
      self.emitSend(sid, payload);
    });
    this.emitActivity();
  }

  _reasonFromGame() {
    var snap = this.game.snapshot();
    if (snap.winner === "draw") return "board-full";
    if (snap.forbidden) return "forbidden";
    return "five";
  }

  _winnerSeatFromGame() {
    var snap = this.game.snapshot();
    if (snap.winner === Game.BLACK) return this.blackSeat;
    if (snap.winner === Game.WHITE) return 1 - this.blackSeat;
    return null;
  }

  /* ================= 協商（§5）================= */

  _otherSeat(seat) { return seat === 0 ? 1 : 0; }

  offerDraw(socketId, seat) {
    this.evaluate();
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) { this.emitInvalid(socketId, null, "目前無法提議和棋"); return; }
    this.negotiation.draw = { by: seat };
    this._broadcast({ t: "drawOffered", by: seat });
    this._touch();
  }

  respondDraw(socketId, seat, accept) {
    this.evaluate();
    if (seat !== 0 && seat !== 1) return; // 觀眾不可參與協商
    var offer = this.negotiation.draw;
    if (!offer || offer.by === seat) return;
    if (accept) {
      this.negotiation.draw = null;
      this.finish("draw-agreed", null);
    } else {
      this.negotiation.draw = null;
      this._broadcast({ t: "drawRejected", by: seat });
      this._touch();
    }
  }

  requestAbort(socketId, seat) {
    this.evaluate();
    if (this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) { this.emitInvalid(socketId, null, "目前無法結束對戰"); return; }
    // 對手斷線 → 直接結束（斷線者無法同意）
    var other = this._otherSeat(seat);
    var opponentOnline = !!(this.seats[other] && this.seats[other].connected);
    if (!opponentOnline) { this.finish("aborted", null); return; }
    this.negotiation.abort = { by: seat };
    this._broadcast({ t: "abortOffered", by: seat });
    this._touch();
  }

  respondAbort(socketId, seat, accept) {
    this.evaluate();
    if (seat !== 0 && seat !== 1) return; // 觀眾不可參與協商
    var offer = this.negotiation.abort;
    if (!offer || offer.by === seat) return;
    if (accept) {
      this.negotiation.abort = null;
      this.finish("aborted", null);
    } else {
      this.negotiation.abort = null;
      this._broadcast({ t: "abortRejected", by: seat });
      this._touch();
    }
  }

  resign(socketId, seat) {
    this.evaluate();
    if (seat === null || this.status !== ROOM_STATUS.PLAYING || this.game.isOver()) return;
    this.finish("resign", this._otherSeat(seat));
  }

  offerRematch(socketId, seat) {
    if (this.status !== ROOM_STATUS.FINISHED) return;
    this.negotiation.rematch = { by: seat };
    this._broadcast({ t: "rematchOffered", by: seat });
    this._touch();
  }

  respondRematch(socketId, seat, accept) {
    if (seat !== 0 && seat !== 1) return; // 觀眾不可參與協商
    var offer = this.negotiation.rematch;
    if (!offer || offer.by === seat) return;
    if (accept) this.startRematch();
    else {
      this.negotiation.rematch = null;
      this._broadcast({ t: "rematchRejected", by: seat });
      this._touch();
    }
  }

  // 再來一局：重洗整盤、先手交換（上一局黑方換人）
  startRematch() {
    this.negotiation = { draw: null, abort: null, rematch: null };
    this.blackSeat = 1 - this.blackSeat;
    this.game = Game.createGame({ size: this.size, ruleset: this.ruleset, vsAI: false });
    this.result = null;
    this.status = ROOM_STATUS.PLAYING;
    this.turn = { deadlineAt: null, pausedRemainingMs: null, graceDeadlineAt: null };
    this.expireAt = now() + config.STALE_TTL_MS;
    this._startTurnClock();
    this._touch();
    this._broadcast({
      t: "rematchStart",
      blackSeat: this.blackSeat,
      state: Protocol.toStateDTO(this.game),
      deadline: this.deadlineDTO()
    });
    this.emitActivity();
  }

  /* ================= 終局 ================= */

  finish(reason, winnerSeat) {
    this.status = ROOM_STATUS.FINISHED;
    this.result = { reason: reason, winnerIndex: winnerSeat };
    this.turn = { deadlineAt: null, pausedRemainingMs: null, graceDeadlineAt: null };
    this.negotiation = { draw: null, abort: null, rematch: null };
    this.expireAt = now() + config.FINISHED_TTL_MS;
    this._touch();
    if (this._nudgeTimer) { clearTimeout(this._nudgeTimer); this._nudgeTimer = null; }
    this._broadcast({
      t: "gameOver",
      reason: reason,
      reasonText: Protocol.reasonText(reason),
      winnerIndex: winnerSeat,
      state: Protocol.toStateDTO(this.game),
      deadline: null
    });
    this.emitPresence();
    this.emitActivity();
  }

  /* ================= 聊天（§6）================= */

  handleChat(socketId, seat, msg) {
    var text = sanitizeChatText(msg.text);
    if (!text) return;
    if (!this._chatAllow(socketId)) {
      this.emitSend(socketId, { t: "error", code: "rate-limited", message: "訊息太頻繁了，休息一下再聊" });
      return;
    }
    var message;
    if (seat === 0 || seat === 1) {
      message = Protocol.chatMessage(ids.newChatId(), seat, "text", text);
    } else {
      var info = this.spectators.get(socketId);
      message = Protocol.chatMessage(ids.newChatId(), "spectator", "text", text, info ? info.name : Protocol.SPECTATOR_NAME);
    }
    this.chat.push(message);
    if (this.chat.length > Protocol.LIMITS.chatHistory) this.chat.splice(0, this.chat.length - Protocol.LIMITS.chatHistory);
    this._touch();
    this._broadcast({ t: "chat", msg: message });
   }

  handleCanned(socketId, seat, msg) {
    var text = Protocol.cannedText(msg.id);
    if (!text) return; // 未知 id 直接丟棄
    if (!this._chatAllow(socketId)) {
      this.emitSend(socketId, { t: "error", code: "rate-limited", message: "訊息太頻繁了，休息一下再聊" });
      return;
    }
    var message;
    if (seat === 0 || seat === 1) {
      message = Protocol.chatMessage(ids.newChatId(), seat, "canned", text, null, msg.id);
    } else {
      var info = this.spectators.get(socketId);
      message = Protocol.chatMessage(ids.newChatId(), "spectator", "canned", text, info ? info.name : Protocol.SPECTATOR_NAME, msg.id);
    }
    this.chat.push(message);
    if (this.chat.length > Protocol.LIMITS.chatHistory) this.chat.splice(0, this.chat.length - Protocol.LIMITS.chatHistory);
    this._touch();
    this._broadcast({ t: "chat", msg: message });
   }

  // per-socket 滑動窗口限速
  _chatAllow(socketId) {
    var nowMs = now();
    var stamps = this.chatLimits.get(socketId) || [];
    stamps = stamps.filter(function (ts) { return nowMs - ts < config.CHAT_WINDOW_MS; });
    if (stamps.length >= config.CHAT_BURST) { this.chatLimits.set(socketId, stamps); return false; }
    if (stamps.length && nowMs - stamps[stamps.length - 1] < config.CHAT_MIN_GAP_MS) { this.chatLimits.set(socketId, stamps); return false; }
    stamps.push(nowMs);
    this.chatLimits.set(socketId, stamps);
    return true;
  }

  /* ================= 推播 ================= */

  _touch() { this.updatedAt = now(); }

  _broadcastDeadline() {
    this._broadcast({ t: "deadline", deadline: this.deadlineDTO() });
    this._scheduleNudge();
  }

  emitPresence() {
    this._broadcast({ t: "presence", presence: this.presenceDTO() });
  }

  _broadcast(payload) {
    var self = this;
    this.seatSockets.forEach(function (sid) { if (sid) self.emitSend(sid, payload); });
    this.spectators.forEach(function (_info, sid) { self.emitSend(sid, payload); });
  }

  emitInvalid(socketId, seq, message, code, warn) {
    var payload = { t: "invalid", message: message };
    if (seq != null) payload.seq = seq;
    if (code) payload.code = code;
    if (warn) payload.warn = warn;
    this.emitSend(socketId, payload);
  }

  // 每房連線數（sweep 用）
  connectionCount() {
    var n = 0;
    for (var s = 0; s < 2; s++) if (this.seatSockets[s]) n++;
    return n + this.spectators.size;
  }

  isIdleFinished() {
    return this.status === ROOM_STATUS.FINISHED && this.connectionCount() === 0;
  }

  dispose() {
    if (this._nudgeTimer) { clearTimeout(this._nudgeTimer); this._nudgeTimer = null; }
  }
}

// 注入發送/關閉/活動通知 callback（由 RoomManager 提供）
Room.prototype.wireTransport = function (send, close, notify) {
  this.emitSend = send;
  this.emitClose = close;
  if (notify) this.emitActivity = notify;
  return this;
};

// 預設 no-op（wireTransport 前的廣播安全落地）
Room.prototype.emitSend = function () { };
Room.prototype.emitClose = function () { };
Room.prototype.emitActivity = function () { };

module.exports = { Room: Room, sanitizeName: sanitizeName, sanitizeChatText: sanitizeChatText };