"use strict";
/* 上行訊息白名窄化：未知 t 一律丟棄（回 bad-message）；已知 t 逐欄位驗型與截斷。
   規則合法性交給規則引擎（server 套用前再驗一次）。 */

var LIMITS = require("../shared/protocol.js").LIMITS;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function str(v, max) {
  if (typeof v !== "string") return null;
  var s = v.slice(0, max);
  return s.length ? s : null;
}

function bool(v) { return typeof v === "boolean" ? v : null; }

function intVal(v) {
  if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v) return null;
  return v;
}

// 回傳窄化後的訊息物件；不合法回 null。
function guardMessage(raw) {
  if (!isPlainObject(raw)) return null;
  var t = raw.t;
  if (typeof t !== "string") return null;
  var out = { t: t };

  switch (t) {
    case "subscribeLobby":
      return out;

    case "join": {
      var roomId = str(raw.roomId, LIMITS.roomId);
      if (!roomId) return null;
      out.roomId = roomId;
      if (raw.playerToken !== undefined) {
        var token = str(raw.playerToken, LIMITS.playerToken);
        if (token) out.playerToken = token;
      }
      if (raw.name !== undefined) {
        var name = str(raw.name, LIMITS.joinName);
        if (name) out.name = name;
      }
      var spectate = bool(raw.spectate);
      if (spectate !== null) out.spectate = spectate;
      return out;
    }

    case "action": {
      var seq = intVal(raw.seq);
      if (seq === null || seq < 1) return null;
      if (!isPlainObject(raw.action)) return null;
      var x = intVal(raw.action.x), y = intVal(raw.action.y);
      if (x === null || y === null) return null;
      out.seq = seq;
      out.action = { x: x, y: y };
      return out;
    }

    case "chat": {
      var text = typeof raw.text === "string" ? raw.text.slice(0, LIMITS.chatRaw) : null;
      if (text === null) return null;
      out.text = text;
      return out;
    }

    case "canned": {
      var id = str(raw.id, LIMITS.cannedId);
      if (!id) return null;
      out.id = id;
      return out;
    }

    case "announcementAck": {
      // 公告 uuid：字串必填，剝除控制字元後截斷至上限，剝完為空視同不合法。
      var ackId = typeof raw.id === "string"
        ? raw.id.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, LIMITS.announcementAck)
        : null;
      if (!ackId) return null;
      out.id = ackId;
      return out;
    }

    case "drawResponse":
    case "abortResponse":
    case "rematchResponse": {
      var accept = bool(raw.accept);
      if (accept === null) return null;
      out.accept = accept;
      return out;
    }

    case "drawOffer":
    case "abortRequest":
    case "resign":
    case "rematch":
      return out;

    default:
      return null;
  }
}

module.exports = { guardMessage: guardMessage, isPlainObject: isPlainObject };