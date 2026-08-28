"use strict";
/* FirestoreAdminStore：後台資料的 Firestore 持久化（dark-chess 同款移植）。
   涵蓋三組介面：公告（saveAnnouncement/loadAnnouncements）、指標小時彙總
   （saveHour/loadHours）、IP 監控（blocks/hours/alerts + 過期清理）。
   Collections：announcements、metrics_hours、ip_hours、ip_blocks、ip_alerts。
   僅在 FIRESTORE_ENABLED 時由程式進入點動態 require 後實例化；
   Firestore client 惰性載入（與 firestore-store.js 同模式）。 */

class FirestoreAdminStore {
  constructor(opts) {
    opts = opts || {};
    var Firestore = require("@google-cloud/firestore").Firestore;
    this.db = new Firestore(opts.clientOptions || {});
    this.announcementsCol = this.db.collection("announcements");
    this.metricHoursCol = this.db.collection("metrics_hours");
    this.ipHoursCol = this.db.collection("ip_hours");
    this.ipBlocksCol = this.db.collection("ip_blocks");
    this.ipAlertsCol = this.db.collection("ip_alerts");
  }

  /* ---- 公告 ---- */

  async saveAnnouncement(record) {
    await this.announcementsCol.doc(record.id).set({
      id: record.id,
      text: record.text,
      at: record.at,
      reached: record.reached,
      acks: Array.from(record.acks || [])
    });
  }

  async loadAnnouncements(limit) {
    var snap = await this.announcementsCol.orderBy("at", "desc").limit(limit).get();
    return snap.docs.map(function (doc) {
      var data = doc.data() || {};
      return {
        id: typeof data.id === "string" ? data.id : doc.id,
        text: typeof data.text === "string" ? data.text : "",
        at: Number(data.at || 0),
        reached: Number(data.reached || 0),
        acks: new Set(Array.isArray(data.acks) ? data.acks.filter(function (name) { return typeof name === "string"; }) : [])
      };
    });
  }

  /* ---- 指標小時彙總 ---- */

  async saveHour(point) {
    await this.metricHoursCol.doc(hourDocId(point.t)).set(point);
  }

  async loadHours(from, to) {
    var snap = await this.metricHoursCol.where("t", ">=", from).where("t", "<=", to).get();
    return snap.docs.map(function (doc) { return doc.data(); });
  }

  /* ---- IP 監控資料 ---- */

  async saveIpBlock(block) {
    await this.ipBlocksCol.doc(block.ip).set(block);
  }

  async deleteIpBlock(ip) {
    await this.ipBlocksCol.doc(ip).delete();
  }

  async loadIpBlocks() {
    var snap = await this.ipBlocksCol.get();
    return snap.docs.map(function (doc) {
      var data = doc.data() || {};
      return {
        ip: typeof data.ip === "string" ? data.ip : doc.id,
        blockedAt: Number(data.blockedAt || 0),
        expiresAt: data.expiresAt === null || data.expiresAt === undefined ? null : Number(data.expiresAt),
        blockedBy: typeof data.blockedBy === "string" ? data.blockedBy : ""
      };
    });
  }

  async saveIpHour(point) {
    await this.ipHoursCol.doc(ipHourDocId(point.ip, point.t)).set(point);
  }

  async loadIpHours(from, to) {
    var snap = await this.ipHoursCol.where("t", ">=", from).where("t", "<=", to).get();
    return snap.docs.map(function (doc) { return doc.data(); });
  }

  async saveIpAlert(alert) {
    await this.ipAlertsCol.doc(alert.id).set(alert);
  }

  async loadIpAlerts(limit) {
    var snap = await this.ipAlertsCol.orderBy("at", "desc").limit(limit).get();
    return snap.docs.map(function (doc) { return doc.data(); });
  }

  async deleteIpDataOlderThan(cutoff) {
    await this.deleteOldDocs(this.ipHoursCol.where("t", "<", cutoff));
    await this.deleteOldDocs(this.ipAlertsCol.where("at", "<", cutoff));
  }

  // 分批刪除過期文件（單批上限 300，避免大查詢一次鎖死）。
  async deleteOldDocs(query) {
    var snap = await query.limit(300).get();
    if (snap.empty) return;
    var batch = this.db.batch();
    snap.docs.forEach(function (doc) { batch.delete(doc.ref); });
    await batch.commit();
  }
}

// 小時桶文件 id：ISO 時間到小時（同一小時冪等覆寫）。
function hourDocId(t) {
  return new Date(t).toISOString().slice(0, 13);
}

// IP 小時桶文件 id：ip_YYYY-MM-DDTHH。
function ipHourDocId(ip, t) {
  return ip + "_" + new Date(t).toISOString().slice(0, 13);
}

module.exports = { FirestoreAdminStore: FirestoreAdminStore };