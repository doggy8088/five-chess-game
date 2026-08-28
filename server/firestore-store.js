"use strict";
/* FirestoreStore：rooms/{roomId} 一房一文件。
   - state/chat 存 JSON 字串（Firestore 不收 undefined，optional 欄位會炸）
   - expireAt 存 Timestamp，collection 開 TTL policy 自動刪：
     gcloud firestore fields ttls update expireAt --collection-group=rooms --enable-ttl */

var rooms = require("./rooms.js");

class FirestoreStore {
  constructor(opts) {
    opts = opts || {};
    var Firestore = require("@google-cloud/firestore").Firestore;
    this.collectionName = opts.collection || "rooms";
    this.db = new Firestore(opts.clientOptions || {});
    this.col = this.db.collection(this.collectionName);
  }

  async load(roomId) {
    var snap = await this.col.doc(roomId).get();
    if (!snap.exists) return null;
    return fromFirestoreDoc(snap.data());
  }

  async save(doc) {
    await this.col.doc(doc.roomId).set(toFirestoreDoc(doc));
  }

  async delete(roomId) {
    await this.col.doc(roomId).delete();
  }

  async listActive(limit) {
    // 戰情中心單一欄位查詢（不需複合索引，記憶體內排序）：
    // 交戰中 + 保留期內的已結束房間都上板（等待房僅存在於快取，重啟後不從 store 撈）。
    var snap = await this.col
      .where("status", "in", ["playing", "finished"])
      .limit(200)
      .get();
    var now = Date.now();
    var docs = [];
    for (var i = 0; i < snap.docs.length; i++) {
      var data = snap.docs[i].data();
      if (data.version !== 1) continue;
      var doc = fromFirestoreDoc(data);
      if (rooms.isLobbyListable(doc, now)) docs.push(doc);
    }
    docs.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return docs.slice(0, limit || 20);
  }
}

function toFirestoreDoc(doc) {
  var out = JSON.parse(JSON.stringify(doc));
  out.stateJson = JSON.stringify(doc.stateJson == null ? null : doc.stateJson);
  out.negotiationJson = JSON.stringify(doc.negotiation == null ? null : doc.negotiation);
  out.chatJson = JSON.stringify(doc.chatJson == null ? [] : doc.chatJson);
  out.expireAt = doc.expireAt ? new Date(doc.expireAt) : null;
  delete out.state;
  delete out.negotiation;
  delete out.chat;
  return out;
}

function fromFirestoreDoc(data) {
  var doc = JSON.parse(JSON.stringify(data));
  try { doc.stateJson = data.stateJson ? JSON.parse(data.stateJson) : null; } catch (e) { doc.stateJson = null; }
  try { doc.negotiation = data.negotiationJson ? JSON.parse(data.negotiationJson) : null; } catch (e) { doc.negotiation = null; }
  try { doc.chatJson = data.chatJson ? JSON.parse(data.chatJson) : []; } catch (e) { doc.chatJson = []; }
  doc.expireAt = data.expireAt && data.expireAt.toMillis ? data.expireAt.toMillis() : data.expireAt || null;
  return doc;
}

module.exports = { FirestoreStore: FirestoreStore };