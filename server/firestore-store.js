"use strict";
/* FirestoreStore：rooms/{roomId} 一房一文件。
   - state/chat 存 JSON 字串（Firestore 不收 undefined，optional 欄位會炸）
   - expireAt 存 Timestamp，collection 開 TTL policy 自動刪：
     gcloud firestore fields ttls update expireAt --collection-group=rooms --enable-ttl */

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
    var q = await this.col
      .where("status", "==", "playing")
      .orderBy("updatedAt", "desc")
      .limit(limit || 20)
      .get();
    return q.docs.map(function (d) { return fromFirestoreDoc(d.data()); });
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