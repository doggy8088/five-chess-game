/* =====================================================================
 * 座位 token 持久化 — localStorage（private mode 失敗就放棄）。
 * key: gomoku:online:{roomId} → {token, savedAt}
 * 暱稱：gomoku:online-name
 * ===================================================================== */
(function (root) {
  "use strict";

  var PREFIX = "gomoku:online:";

  function key(roomId) { return PREFIX + roomId; }

  function saveToken(roomId, token) {
    try {
      localStorage.setItem(key(roomId), JSON.stringify({ token: token, savedAt: Date.now() }));
    } catch (e) { /* private mode：放棄 */ }
  }

  function loadToken(roomId) {
    try {
      var raw = localStorage.getItem(key(roomId));
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (saved && saved.token) return saved.token;
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function clearToken(roomId) {
    try { localStorage.removeItem(key(roomId)); } catch (e) { /* 忽略 */ }
  }

  function saveName(name) {
    try { localStorage.setItem(PREFIX + "name", name); } catch (e) { /* 忽略 */ }
  }

  function loadName() {
    try { return localStorage.getItem(PREFIX + "name") || ""; } catch (e) { return ""; }
  }

  var api = { saveToken: saveToken, loadToken: loadToken, clearToken: clearToken, saveName: saveName, loadName: loadName };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OnlineTokens = api;
})(typeof self !== "undefined" ? self : this);