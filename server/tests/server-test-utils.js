"use strict";
/* 測試工具：FakeTransport 收發記錄 + 組房 helper。 */

var Room = require("../room.js").Room;

class FakeTransport {
  constructor() { this.sent = []; this.closed = []; this.notifyCount = 0; }

  send(socketId, payload) { this.sent.push({ socketId: socketId, payload: payload }); }
  close(socketId, code, reason) { this.closed.push({ socketId: socketId, code: code, reason: reason }); }
  notify() { this.notifyCount++; }

  // 某 socket 收到的所有訊息
  to(socketId) {
    return this.sent.filter(function (s) { return s.socketId === socketId; }).map(function (s) { return s.payload; });
  }
  // 某 socket 最新一則 t 類型的訊息
  last(socketId, t) {
    var list = this.to(socketId).filter(function (p) { return p.t === t; });
    return list.length ? list[list.length - 1] : null;
  }
  clear() { this.sent = []; }
}

// 建立新房（建立者已佔 seat 0，尚未有任何連線）
function makeRoom(opts) {
  var transport = new FakeTransport();
  var room = Room.create(Object.assign({ name: "玩家一", ruleset: "standard" }, opts));
  room.wireTransport(function (sid, p) { transport.send(sid, p); },
    function (sid, code, reason) { transport.close(sid, code, reason); },
    function () { transport.notify(); });
  return { room: room, transport: transport };
}

// 兩位坐滿開打的房間（seat0=阿黑、seat1=阿白），回傳 socketId 對照
function makePlayingRoom() {
  var ctx = makeRoom({ name: "阿黑", ruleset: "standard" });
  var room = ctx.room;
  room.join("s0", { roomId: room.roomId, playerToken: room.seats[0].token, name: "阿黑" });
  room.join("s1", { roomId: room.roomId, name: "阿白" });
  ctx.transport.clear();
  return Object.assign(ctx, { s0: "s0", s1: "s1" });
}

module.exports = { FakeTransport: FakeTransport, makeRoom: makeRoom, makePlayingRoom: makePlayingRoom };