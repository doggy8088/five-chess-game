/* =====================================================================
 * ReconnectingSocket — WS 自動重連是正常流程，不是錯誤處理。
 * 斷線指數退避 1s→×1.7→10s；visibilitychange 回到前景立刻重試；
 * close() 之後不再重連；收到 malformed frame 忽略。
 * ===================================================================== */
(function (root) {
  "use strict";

  function wsUrl() {
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    return proto + location.host + "/ws";
  }

  function ReconnectingSocket(opts) {
    opts = opts || {};
    this.url = opts.url || wsUrl();
    this.onOpen = opts.onOpen || function () { };
    this.onMessage = opts.onMessage || function () { };
    this.onDown = opts.onDown || function () { };
    this.onRetryScheduled = opts.onRetryScheduled || function () { };
    this.baseDelay = 1000;
    this.maxDelay = 10000;
    this.factor = 1.7;
    this._ws = null;
    this._retryTimer = null;
    this._closed = false;
    this._delay = 0;
    this._hadSuccess = false;
  }

  ReconnectingSocket.prototype.connect = function () {
    var self = this;
    if (this._closed) return;
    try { if (this._ws) { this._ws.onclose = null; this._ws.close(); } } catch (e) { /* 忽略 */ }
    var ws;
    try { ws = new WebSocket(this.url); }
    catch (e) { this._scheduleRetry(); return; }
    this._ws = ws;

    ws.onopen = function () {
      self._delay = 0;
      self._hadSuccess = true;
      self.onOpen();
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(String(ev.data)); } catch (e) { return; } // malformed frame 忽略
      self.onMessage(msg);
    };
    ws.onclose = function () {
      if (self._closed || self._ws !== ws) return;
      self.onDown(self._hadSuccess);
      self._scheduleRetry();
    };
    ws.onerror = function () { /* close 會接手 */ };
  };

  ReconnectingSocket.prototype._scheduleRetry = function () {
    var self = this;
    if (this._closed) return;
    if (!this._delay) this._delay = this.baseDelay;
    else this._delay = Math.min(Math.round(this._delay * this.factor), this.maxDelay);
    this.onRetryScheduled(this._delay);
    this._retryTimer = setTimeout(function () { self._retryTimer = null; self.connect(); }, this._delay);
  };

  // 回到前景立刻重試
  ReconnectingSocket.prototype.wireVisibility = function () {
    var self = this;
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || self._closed) return;
      var ws = self._ws;
      var dead = !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
      if (dead) {
        if (self._retryTimer) { clearTimeout(self._retryTimer); self._retryTimer = null; }
        self._delay = 0;
        self.connect();
      }
    });
  };

  ReconnectingSocket.prototype.send = function (obj) {
    var ws = this._ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
    return false;
  };

  ReconnectingSocket.prototype.close = function () {
    this._closed = true;
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    try { if (this._ws) { this._ws.onclose = null; this._ws.close(); } } catch (e) { /* 忽略 */ }
    this._ws = null;
  };

  ReconnectingSocket.wsUrl = wsUrl;

  if (typeof module !== "undefined" && module.exports) module.exports = { ReconnectingSocket: ReconnectingSocket, wsUrl: wsUrl };
  else root.ReconnectingSocket = ReconnectingSocket;
})(typeof self !== "undefined" ? self : this);