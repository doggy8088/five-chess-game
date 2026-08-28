"use strict";
/* 全站公告看板（後台用）：同一時間僅一則生效公告，重新發佈即取代舊公告；
   每次推播都要求玩家明確回報已讀（announcementAck），管理端據此追蹤誰看過。
   歷史保留最近 50 則。可選 persistence adapter 介面（與 dark-chess 相同）：
   { saveAnnouncement(record): Promise<void>, loadAnnouncements(limit): Promise<AnnouncementRecord[]> }
   AnnouncementRecord：{ id: uuid, text, at, reached, acks: Set<玩家名稱> }
   AnnouncementView：{ id, text, at, reached, acks: 已讀人數 } */

var randomUUID = require("node:crypto").randomUUID;

var HISTORY_LIMIT = 50;
var TEXT_MAX = 500;

/* 清洗公告內容：剝除控制字元 → trim → 上限 500 字（以碼點計，emoji 不切半）。 */
function sanitizeAnnouncementText(raw) {
  var text = typeof raw === "string" ? raw : "";
  text = text.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return Array.from(text).slice(0, TEXT_MAX).join("");
}

class AnnouncementBoard {
  constructor(persistence) {
    this.records = [];
    this.activeId = null;
    this.persistence = persistence || null;
  }

  // 重啟後還原最近公告（best-effort，失敗不影響服務）。
  async init() {
    if (!this.persistence) return;
    try {
      var loaded = await this.persistence.loadAnnouncements(HISTORY_LIMIT);
      this.records = loaded.map(function (record) {
        return { id: record.id, text: record.text, at: record.at, reached: record.reached, acks: new Set(record.acks) };
      });
      this.activeId = this.records.length ? this.records[0].id : null;
    } catch (error) {
      console.error("announcement restore failed", error);
    }
  }

  // 發佈新公告：清洗後成為生效公告並取代舊的；回傳新紀錄。
  post(text, reached, now) {
    var record = {
      id: randomUUID(),
      text: sanitizeAnnouncementText(text),
      at: typeof now === "number" ? now : Date.now(),
      reached: reached,
      acks: new Set()
    };
    this.records.unshift(record);
    if (this.records.length > HISTORY_LIMIT) this.records.length = HISTORY_LIMIT;
    this.activeId = record.id;
    this.persist(record);
    return record;
  }

  current() {
    for (var i = 0; i < this.records.length; i++) {
      if (this.records[i].id === this.activeId) return this.records[i];
    }
    return null;
  }

  // 記錄已讀回條；未知 id 或空名稱忽略，同名只算一次。
  ack(id, name) {
    var record = null;
    for (var i = 0; i < this.records.length; i++) {
      if (this.records[i].id === id) { record = this.records[i]; break; }
    }
    if (!record || !name) return;
    if (record.acks.has(name)) return;
    record.acks.add(name);
    this.persist(record);
  }

  // 歷史清單（新→舊），acks 轉為已讀人數。
  list() {
    return this.records.map(function (record) {
      return { id: record.id, text: record.text, at: record.at, reached: record.reached, acks: record.acks.size };
    });
  }

  // 逐筆保存（fire-and-forget）：同步或非同步丟錯都只記 log，不影響公告功能。
  persist(record) {
    if (!this.persistence) return;
    try {
      var result = this.persistence.saveAnnouncement(record);
      if (result && typeof result.catch === "function") {
        result.catch(function (error) { console.error("announcement persist failed", error); });
      }
    } catch (error) {
      console.error("announcement persist failed", error);
    }
  }
}

module.exports = { AnnouncementBoard: AnnouncementBoard, HISTORY_LIMIT: HISTORY_LIMIT };