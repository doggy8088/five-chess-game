"use strict";
/* RoomStore（InMemory）與 RoomManager 行為測試。 */

var test = require("node:test");
var assert = require("node:assert");
var storeMod = require("../store.js");
var RoomManager = require("../rooms.js").RoomManager;
var FakeTransport = require("./server-test-utils.js").FakeTransport;
var Room = require("../room.js").Room;

test("store：InMemoryStore CRUD", async () => {
  var store = new storeMod.InMemoryStore();
  var room = Room.create({ name: "阿黑" });
  await store.save(room.toDoc());
  var doc = await store.load(room.roomId);
  assert.ok(doc);
  assert.equal(doc.roomId, room.roomId);
  assert.equal(doc.status, "waiting");
  await store.delete(room.roomId);
  assert.equal(await store.load(room.roomId), null);
});

test("store：listActive 只列 playing，依 updatedAt 新→舊", async () => {
  var store = new storeMod.InMemoryStore();
  var r1 = Room.create({ name: "A" });
  r1.status = "playing"; r1.updatedAt = 100;
  var r2 = Room.create({ name: "B" });
  r2.status = "playing"; r2.updatedAt = 300;
  var r3 = Room.create({ name: "C" });
  r3.status = "finished"; r3.updatedAt = 500;
  await store.save(r1.toDoc());
  await store.save(r2.toDoc());
  await store.save(r3.toDoc());
  var docs = await store.listActive(10);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].roomId, r2.roomId);
  assert.equal(docs[1].roomId, r1.roomId);
});

test("manager：listGames 只列 playing 且滿座的局、只含公開欄位", async () => {
  var store = new storeMod.InMemoryStore();
  var transport = new FakeTransport();
  var manager = new RoomManager(store, { send: transport.send.bind(transport), close: transport.close.bind(transport) });

  var full = manager.createRoom("阿黑", "standard");
  full.join("s0", { roomId: full.roomId, playerToken: full.seats[0].token });
  full.join("s1", { roomId: full.roomId, name: "阿白" });

  var waiting = manager.createRoom("等一個", "standard");
  waiting.join("s9", { roomId: waiting.roomId, playerToken: waiting.seats[0].token });

  var finished = manager.createRoom("下完了", "standard");
  finished.join("s8", { roomId: finished.roomId, playerToken: finished.seats[0].token });
  finished.join("s7", { roomId: finished.roomId, name: "對手" });
  finished.resign("s0", 0);

  var games = await manager.listGames(20);
  assert.equal(games.length, 1);
  assert.equal(games[0].roomId, full.roomId);
  assert.equal(games[0].players.length, 2);
  assert.ok(games[0].players[0].name);
  assert.equal(games[0].players[0].color, "black");
  assert.equal(games[0].players[1].color, "white");
  assert.equal(typeof games[0].blackCount, "number");
  assert.equal(typeof games[0].turnNumber, "number");
});

test("manager：並發載入合併成同一個 Room（不會分岔）", async () => {
  var store = new storeMod.InMemoryStore();
  var room = Room.create({ name: "阿黑" });
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token });
  await store.save(room.toDoc());

  var transport = new FakeTransport();
  var manager = new RoomManager(store, { send: transport.send.bind(transport), close: transport.close.bind(transport) });
  var pair = await Promise.all([manager.get(room.roomId), manager.get(room.roomId)]);
  assert.strictEqual(pair[0], pair[1], "兩次並發 get 應回同一個 Room 實例");
});

test("manager：sweep 逐出 finished 且無人連線的房間", async () => {
  var store = new storeMod.InMemoryStore();
  var transport = new FakeTransport();
  var manager = new RoomManager(store, { send: transport.send.bind(transport), close: transport.close.bind(transport) });
  var room = manager.createRoom("阿黑", "standard");
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token });
  room.join("s1", { roomId: room.roomId, name: "阿白" });
  room.resign("s0", 0);
  room.disconnect("s0");
  room.disconnect("s1");
  await manager.persist(room); // index.js 在每則訊息後 write-through；測試同步呼叫需等寫入

  assert.ok(manager.cache.has(room.roomId));
  manager.sweep();
  assert.equal(manager.cache.has(room.roomId), false, "finished 且無人連線應逐出快取");
  var doc = await store.load(room.roomId);
  assert.ok(doc, "store 裡應留到 TTL");
});

test("manager：sweep 刪除過期房間（含 store）", async () => {
  var store = new storeMod.InMemoryStore();
  var transport = new FakeTransport();
  var manager = new RoomManager(store, { send: transport.send.bind(transport), close: transport.close.bind(transport) });
  var room = manager.createRoom("阿黑", "standard");
  room.expireAt = Date.now() - 1;
  manager.sweep();
  assert.equal(manager.cache.has(room.roomId), false);
  assert.equal(await store.load(room.roomId), null);
});

test("manager：房間活動會通知 lobby subscriber（50ms debounce）", async () => {
  var store = new storeMod.InMemoryStore();
  var transport = new FakeTransport();
  var manager = new RoomManager(store, { send: transport.send.bind(transport), close: transport.close.bind(transport) });
  manager.subscribeLobby("sub1");
  var room = manager.createRoom("阿黑", "standard");
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token });
  await new Promise(function (r) { setTimeout(r, 120); }); // 等 debounce
  var lobbyMsgs = transport.to("sub1").filter(m => m.t === "lobby");
  assert.ok(lobbyMsgs.length >= 1, "應收到 lobby 推播");
  var last = lobbyMsgs[lobbyMsgs.length - 1];
  assert.ok(Array.isArray(last.games));
});