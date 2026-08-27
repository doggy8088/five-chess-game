"use strict";
/* 房號 / 座位 token / 聊天訊息 id 產生器。
   房號用無歧義 base32（去掉 0/1/o/l/i），10 碼小寫，不可猜——邀請連結是唯一入場憑證。 */

var crypto = require("crypto");

// 22 個字母（去 i/l/o）+ 6 個數字（2-6、9），共 28 個無歧義字元
var ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
var ROOM_ID_LEN = 10;

var ROOM_ID_RE = /^[a-z2-9]{10}$/;

function newRoomId() {
  var bytes = crypto.randomBytes(ROOM_ID_LEN);
  var out = "";
  for (var i = 0; i < ROOM_ID_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function newPlayerToken() {
  return crypto.randomBytes(16).toString("hex");
}

function newChatId() {
  return crypto.randomBytes(8).toString("hex");
}

module.exports = { newRoomId: newRoomId, newPlayerToken: newPlayerToken, newChatId: newChatId, ROOM_ID_RE: ROOM_ID_RE };