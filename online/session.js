/* =====================================================================
 * OnlineSession — 一個 session 綁一個房間。
 * 負責：WS 重連、每次 onOpen 重送 join、seq 遞增、deadline 倒數（時鐘偏移校正）、
 * 把協定訊息路由成一組 UI callbacks。離開房間時 dispose()。
 * ===================================================================== */
(function (root) {
  "use strict";

  var RS = (root && root.ReconnectingSocket) ||
    (typeof module !== "undefined" && module.exports ? require("./socket.js").ReconnectingSocket : null);
  var Tokens = (root && root.OnlineTokens) ||
    (typeof module !== "undefined" && module.exports ? require("./tokens.js") : null);

  function OnlineSession(opts) {
    opts = opts || {};
    this.roomId = opts.roomId;
    this.playerToken = opts.playerToken || null;
    this.name = opts.name || null;
    this.spectate = !!opts.spectate;
    var SocketClass = opts.socketClass || RS;
    this.socket = new SocketClass({
      onOpen: this._handleOpen.bind(this),
      onMessage: this._handleMessage.bind(this),
      onDown: this._handleDown.bind(this)
    });
    this.socket.wireVisibility();
    this.seat = null;
    this.blackSeat = 0;
    this.roomStatus = null;
    this.seq = 0;
    this._deadline = null;      // {seat, at, pausedRemainingMs, graceAt, serverNow}
    this._clockOffset = 0;      // serverNow - Date.now()
    this._tickTimer = null;
    this.cb = {
      onJoined: opts.onJoined || function () { },
      onState: opts.onState || function () { },
      onActionApplied: opts.onActionApplied || function () { },
      onInvalid: opts.onInvalid || function () { },
      onChat: opts.onChat || function () { },
      onChatHistory: opts.onChatHistory || function () { },
      onPresence: opts.onPresence || function () { },
      onDeadline: opts.onDeadline || function () { },
      onCountdown: opts.onCountdown || function () { },
      onDrawOffered: opts.onDrawOffered || function () { },
      onDrawRejected: opts.onDrawRejected || function () { },
      onAbortOffered: opts.onAbortOffered || function () { },
      onAbortRejected: opts.onAbortRejected || function () { },
      onRematchOffered: opts.onRematchOffered || function () { },
      onRematchRejected: opts.onRematchRejected || function () { },
      onRematchStart: opts.onRematchStart || function () { },
      onGameOver: opts.onGameOver || function () { },
      onLobby: opts.onLobby || function () { },
      onConnectionChanged: opts.onConnectionChanged || function () { },
      onRoomNotFound: opts.onRoomNotFound || function () { },
      onRateLimited: opts.onRateLimited || function () { },
      onConnectedElsewhere: opts.onConnectedElsewhere || function () { },
      onError: opts.onError || function () { }
    };
  }

  OnlineSession.prototype.connect = function () {
    this.socket.connect();
  };

  OnlineSession.prototype._handleOpen = function () {
    // 每次連上都要重送 join（重連後即無縫復原）
    this.socket.send({
      t: "join",
      roomId: this.roomId,
      playerToken: this.playerToken || undefined,
      name: this.name || undefined,
      spectate: this.spectate || undefined
    });
    this.cb.onConnectionChanged(true);
  };

  OnlineSession.prototype._handleDown = function (hadSuccess) {
    this.cb.onConnectionChanged(false);
  };

  OnlineSession.prototype._handleMessage = function (msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "joined":
        this.seat = msg.seat;
        this.blackSeat = msg.blackSeat || 0;
        this.roomStatus = msg.roomStatus;
        if (msg.playerToken && msg.seat !== null) {
          this.playerToken = msg.playerToken;
          if (Tokens) Tokens.saveToken(this.roomId, this.playerToken);
        }
        this._applyDeadline(msg.deadline);
        this.cb.onChatHistory(msg.chat || []);
        this.cb.onPresence(msg.presence);
        this.cb.onJoined(msg);
        break;
      case "state":
        this.blackSeat = msg.blackSeat || this.blackSeat;
        if (msg.roomStatus) this.roomStatus = msg.roomStatus;
        this._applyDeadline(msg.deadline);
        this.cb.onState(msg);
        break;
      case "actionApplied":
        this._applyDeadline(msg.deadline);
        this.cb.onActionApplied(msg);
        break;
      case "invalid":
        this.cb.onInvalid(msg);
        break;
      case "chat":
        this.cb.onChat(msg.msg);
        break;
      case "presence":
        this.cb.onPresence(msg.presence);
        break;
      case "deadline":
        this._applyDeadline(msg.deadline);
        break;
      case "drawOffered": this.cb.onDrawOffered(msg.by); break;
      case "drawRejected": this.cb.onDrawRejected(msg.by); break;
      case "abortOffered": this.cb.onAbortOffered(msg.by); break;
      case "abortRejected": this.cb.onAbortRejected(msg.by); break;
      case "rematchOffered": this.cb.onRematchOffered(msg.by); break;
      case "rematchRejected": this.cb.onRematchRejected(msg.by); break;
      case "rematchStart":
        this.blackSeat = msg.blackSeat || 0;
        this.roomStatus = "playing";
        this._applyDeadline(msg.deadline);
        this.cb.onRematchStart(msg);
        break;
      case "gameOver":
        this.roomStatus = "finished";
        this._applyDeadline(null);
        this.cb.onGameOver(msg);
        break;
      case "lobby":
        this.cb.onLobby(msg.games || []);
        break;
      case "error":
        if (msg.code === "room-not-found") this.cb.onRoomNotFound(msg);
        else if (msg.code === "rate-limited") this.cb.onRateLimited(msg);
        else if (msg.code === "connected-elsewhere") {
          this.cb.onConnectedElsewhere(msg);
          this.socket.close();
        } else this.cb.onError(msg);
        break;
      default:
        break; // 未知訊息忽略
    }
  };

  /* ---- 動作 ---- */

  OnlineSession.prototype.sendAction = function (x, y) {
    this.seq += 1;
    this.socket.send({ t: "action", seq: this.seq, action: { x: x, y: y } });
    return this.seq;
  };

  OnlineSession.prototype.sendChat = function (text) { this.socket.send({ t: "chat", text: text }); };
  OnlineSession.prototype.sendCanned = function (id) { this.socket.send({ t: "canned", id: id }); };
  OnlineSession.prototype.offerDraw = function () { this.socket.send({ t: "drawOffer" }); };
  OnlineSession.prototype.respondDraw = function (accept) { this.socket.send({ t: "drawResponse", accept: !!accept }); };
  OnlineSession.prototype.requestAbort = function () { this.socket.send({ t: "abortRequest" }); };
  OnlineSession.prototype.respondAbort = function (accept) { this.socket.send({ t: "abortResponse", accept: !!accept }); };
  OnlineSession.prototype.resign = function () { this.socket.send({ t: "resign" }); };
  OnlineSession.prototype.offerRematch = function () { this.socket.send({ t: "rematch" }); };
  OnlineSession.prototype.respondRematch = function (accept) { this.socket.send({ t: "rematchResponse", accept: !!accept }); };
  OnlineSession.prototype.subscribeLobby = function () { this.socket.send({ t: "subscribeLobby" }); };

  /* ---- deadline 倒數（時鐘偏移校正，250ms tick）---- */

  OnlineSession.prototype._applyDeadline = function (deadline) {
    this._deadline = deadline || null;
    if (deadline && deadline.serverNow) {
      this._clockOffset = deadline.serverNow - Date.now();
    }
    this.cb.onCountdown(this._countdown());
    this._startTick();
  };

  OnlineSession.prototype._startTick = function () {
    var self = this;
    if (this._tickTimer) clearInterval(this._tickTimer);
    if (!this._deadline) return;
    this._tickTimer = setInterval(function () {
      self.cb.onCountdown(self._countdown());
    }, 250);
  };

  OnlineSession.prototype._countdown = function () {
    if (!this._deadline) return null;
    var now = Date.now() + this._clockOffset; // 用伺服器時鐘計算
    var out = {
      seat: this._deadline.seat,
      remainingMs: this._deadline.at ? this._deadline.at - now : null,
      graceRemainingMs: this._deadline.graceAt ? this._deadline.graceAt - now : null,
      pausedRemainingMs: this._deadline.pausedRemainingMs != null ? this._deadline.pausedRemainingMs : null
    };
    return out;
  };

  OnlineSession.prototype.serverNow = function () { return Date.now() + this._clockOffset; };

  OnlineSession.prototype.dispose = function () {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
    this.socket.close();
  };

  root.OnlineSession = OnlineSession;
})(typeof self !== "undefined" ? self : this);