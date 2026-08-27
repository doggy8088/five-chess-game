"use strict";
/* 可插拔 RoomStore 介面 + InMemoryStore。
   RoomDoc（一房一份，重啟可完整重建）：
   { version, roomId, status, stateJson, blackSeat,
     seats: [{token,name}|null, {token,name}|null],
     turn: { deadlineAt, pausedRemainingMs, graceDeadlineAt },
     negotiation: {...}, chatJson, result: {reason, winnerIndex}|null,
     createdAt, updatedAt, expireAt } */

class InMemoryStore {
  constructor() { this.map = new Map(); }

  async load(roomId) {
    return this.map.get(roomId) || null;
  }

  async save(doc) {
    this.map.set(doc.roomId, JSON.parse(JSON.stringify(doc)));
  }

  async delete(roomId) {
    this.map.delete(roomId);
  }

  // status==='playing'，updatedAt 新→舊
  async listActive(limit) {
    var docs = [];
    this.map.forEach(function (doc) { if (doc.status === "playing") docs.push(doc); });
    docs.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return docs.slice(0, limit || 20);
  }

  async listAll() {
    return Array.from(this.map.values());
  }
}

module.exports = { InMemoryStore: InMemoryStore };