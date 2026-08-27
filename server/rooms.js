"use strict";
/* RoomManager：房間快取、並發載入合併（避免重啟後兩人同時 join 造出兩個分岔 Room）、
   write-through 每房寫入序列化、lobby 名單合併與 50ms debounce 推播、60s sweep。 */

var Protocol = require("../shared/protocol.js");
var config = require("./config.js");
var ids = require("./ids.js");
var Room = require("./room.js").Room;

class RoomManager {
  // transport: { send(socketId, payload), close(socketId, code, reason) }
  constructor(store, transport) {
    this.store = store;
    this.transport = transport;
    this.cache = new Map();        // roomId -> Room
    this.inFlight = new Map();     // roomId -> Promise<Room>
    this.writeChains = new Map();  // roomId -> Promise（每房寫入序列化）
    this.lobbySubscribers = new Map(); // socketId -> boolean
    this._lobbyTimer = null;
    var self = this;
    this._notify = function () { self.notifyActivity(); };
  }

  /* ---- 建立 / 載入 ---- */

  createRoom(name, ruleset) {
    var room = Room.create({ name: name, ruleset: ruleset });
    room.wireTransport(this.transport.send, this.transport.close, this._notify);
    this.cache.set(room.roomId, room);
    this.persist(room);
    this.notifyActivity();
    return room;
  }

  // 快取 + 並發載入合併；找不到回 null
  get(roomId) {
    if (!roomId || !ids.ROOM_ID_RE.test(roomId)) return Promise.resolve(null);
    var cached = this.cache.get(roomId);
    if (cached) return Promise.resolve(cached);
    var inFlight = this.inFlight.get(roomId);
    if (inFlight) return inFlight;
    var self = this;
    var p = this.store.load(roomId).then(function (doc) {
      self.inFlight.delete(roomId);
      if (!doc) return null;
      var existing = self.cache.get(roomId);
      if (existing) return existing;
      var room = Room.fromDoc(doc);
      room.wireTransport(self.transport.send, self.transport.close, self._notify);
      self.cache.set(room.roomId, room);
      return room;
    }, function (err) {
      self.inFlight.delete(roomId);
      throw err;
    });
    this.inFlight.set(roomId, p);
    return p;
  }

  /* ---- 持久化：write-through + 每房序列化（慢寫不會被後寫超車）---- */

  persist(room) {
    var roomId = room.roomId;
    var doc = room.toDoc();
    var self = this;
    var prev = this.writeChains.get(roomId) || Promise.resolve();
    var next = prev.then(function () { return self.store.save(doc); }, function () { return self.store.save(doc); });
    // 寫入失敗不讓鏈斷掉，僅記錄
    next = next.catch(function (err) { console.error("[rooms] persist failed", roomId, err && err.message); });
    this.writeChains.set(roomId, next);
    return next;
  }

  /* ---- Lobby ---- */

  subscribeLobby(socketId) {
    this.lobbySubscribers.set(socketId, true);
  }

  unsubscribeLobby(socketId) {
    this.lobbySubscribers.delete(socketId);
  }

  // 房間活動 → 50ms debounce 合併後推播 lobby
  notifyActivity() {
    if (this._lobbyTimer) return;
    var self = this;
    this._lobbyTimer = setTimeout(function () {
      self._lobbyTimer = null;
      self.pushLobby();
    }, Protocol.LOBBY_DEBOUNCE_MS);
    if (this._lobbyTimer.unref) this._lobbyTimer.unref();
  }

  pushLobby() {
    if (!this.lobbySubscribers.size) return;
    var self = this;
    this.listGames(Protocol.LOBBY_PUSH_LIMIT).then(function (games) {
      self.lobbySubscribers.forEach(function (_v, socketId) {
        self.transport.send(socketId, { t: "lobby", games: games });
      });
    }).catch(function (err) { console.error("[rooms] pushLobby failed", err && err.message); });
  }

  gameSummaryFromRoom(room) {
    var snap = room.game.snapshot();
    var blackSeat = room.blackSeat;
    var whiteSeat = 1 - blackSeat;
    var blackCount = 0, whiteCount = 0;
    snap.moves.forEach(function (m) { if (m.player === 1) blackCount++; else if (m.player === 2) whiteCount++; });
    function playerAt(seat) {
      var color = null;
      if (room.status === "playing" || room.status === "finished") color = seat === blackSeat ? "black" : "white";
      return { name: room.seats[seat] ? room.seats[seat].name : null, color: color };
    }
    return {
      roomId: room.roomId,
      players: [playerAt(blackSeat), playerAt(whiteSeat)],
      blackCount: blackCount,
      whiteCount: whiteCount,
      turnNumber: snap.moves.length,
      spectators: room.spectators.size,
      updatedAt: room.updatedAt
    };
  }

  gameSummaryFromDoc(doc) {
    var moves = (doc.stateJson && doc.stateJson.moves) || [];
    var blackCount = 0, whiteCount = 0;
    moves.forEach(function (m) { if (m.player === 1) blackCount++; else if (m.player === 2) whiteCount++; });
    var blackSeat = doc.blackSeat === 1 ? 1 : 0;
    function playerAt(seat) {
      return {
        name: doc.seats[seat] ? doc.seats[seat].name : null,
        color: seat === blackSeat ? "black" : "white"
      };
    }
    return {
      roomId: doc.roomId,
      players: [playerAt(blackSeat), playerAt(whiteSeat)],
      blackCount: blackCount,
      whiteCount: whiteCount,
      turnNumber: moves.length,
      spectators: 0, // 快取外的房間沒有連線中的觀眾
      updatedAt: doc.updatedAt
    };
  }

  // 只列 playing 且兩座都有人；快取房 + store listActive 合併去重，updatedAt 新→舊
  async listGames(limit) {
    limit = limit || Protocol.LOBBY_HTTP_LIMIT;
    var summaries = new Map();
    var self = this;
    this.cache.forEach(function (room) {
      if (room.status === "playing" && room.seats[0] && room.seats[1]) {
        summaries.set(room.roomId, self.gameSummaryFromRoom(room));
      }
    });
    try {
      var docs = await this.store.listActive(limit);
      docs.forEach(function (doc) {
        if (!summaries.has(doc.roomId) && doc.seats[0] && doc.seats[1]) {
          summaries.set(doc.roomId, self.gameSummaryFromDoc(doc));
        }
      });
    } catch (e) { /* store 失敗時僅回快取 */ }
    var list = Array.from(summaries.values());
    list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return list.slice(0, limit);
  }

  /* ---- Sweep：finished 且無人連線的房間逐出快取（store 裡留到 TTL）---- */

  sweep() {
    var self = this;
    var nowMs = Date.now();
    this.cache.forEach(function (room, roomId) {
      if (room.expireAt && nowMs >= room.expireAt) {
        room.dispose();
        self.cache.delete(roomId);
        self.store.delete(roomId).catch(function () { });
        return;
      }
      if (room.isIdleFinished()) {
        room.dispose();
        self.cache.delete(roomId);
      }
    });
  }

  startSweepTimer() {
    var self = this;
    var timer = setInterval(function () { self.sweep(); }, config.ROOM_SWEEP_MS);
    if (timer.unref) timer.unref();
    return timer;
  }

  disposeAll() {
    this.cache.forEach(function (room) { room.dispose(); });
    this.cache.clear();
  }
}

module.exports = { RoomManager: RoomManager };