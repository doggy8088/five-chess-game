"use strict";
/* 戰情中心公開曝光規則：isLobbyListable 純函式單元測試。
   規則（鏡射 dark-chess store.ts）：
   - playing：一律可列（未坐滿由 listGames 另行排除）
   - waiting：建立滿 LOBBY_WAIT_VISIBILITY_MS（30s）後公開曝光
   - finished：終局（updatedAt）起 LOBBY_ENDED_RETENTION_MS（5 分鐘）內保留曝光 */

var test = require("node:test");
var assert = require("node:assert");
var rooms = require("../server/rooms.js");

var isLobbyListable = rooms.isLobbyListable;
var WAIT = rooms.LOBBY_WAIT_VISIBILITY_MS;
var RETENTION = rooms.LOBBY_ENDED_RETENTION_MS;

test("lobby 規則：常數值（30 秒曝光 / 5 分鐘保留）", () => {
  assert.equal(WAIT, 30000);
  assert.equal(RETENTION, 300000);
});

test("lobby 規則：playing 一律可列", () => {
  var t = 1700000000000;
  assert.equal(isLobbyListable({ status: "playing", createdAt: t, updatedAt: t }, t + 1), true);
  assert.equal(isLobbyListable({ status: "playing", createdAt: t, updatedAt: t }, t + 60 * 60 * 1000), true);
});

test("lobby 規則：waiting 建立滿 30 秒才公開曝光", () => {
  var created = 1700000000000;
  var doc = { status: "waiting", createdAt: created, updatedAt: created };
  assert.equal(isLobbyListable(doc, created), false, "剛建立不列");
  assert.equal(isLobbyListable(doc, created + WAIT - 1), false, "29.999 秒不列");
  assert.equal(isLobbyListable(doc, created + WAIT), true, "剛好 30 秒起列出");
});

test("lobby 規則：finished 自終局起 5 分鐘內保留", () => {
  var endedAt = 1700000000000;
  var doc = { status: "finished", createdAt: endedAt - 60000, updatedAt: endedAt };
  assert.equal(isLobbyListable(doc, endedAt), true);
  assert.equal(isLobbyListable(doc, endedAt + RETENTION - 1), true, "差 1ms 仍在保留期");
  assert.equal(isLobbyListable(doc, endedAt + RETENTION), false, "屆滿即下板");
});

test("lobby 規則：finished 無 updatedAt 時不炸（視為已逾期）", () => {
  assert.equal(isLobbyListable({ status: "finished", createdAt: 1 }, 1700000000000), false);
});

test("lobby 規則：未知狀態／空物件 → false；省略 now 以現在時間判定", () => {
  assert.equal(isLobbyListable({ status: "aborted", createdAt: Date.now(), updatedAt: Date.now() }), false);
  assert.equal(isLobbyListable(null), false);
  // 未傳 nowMs：以 Date.now() 判定 —— 剛建立的 waiting 必定不可列
  assert.equal(isLobbyListable({ status: "waiting", createdAt: Date.now(), updatedAt: Date.now() }), false);
  // 省略 nowMs：long-ago finished 不可列
  assert.equal(isLobbyListable({ status: "finished", createdAt: 1, updatedAt: 1 }), false);
});