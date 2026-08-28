"use strict";
/* 依 IP 的流量追蹤、異常告警與封鎖（後台監控用）。
   設計給人類判斷濫用：分鐘計數對閥值產生告警、小時桶保留 7 天歷史、
   封鎖名單支援限時或永久停權。
   記憶體上限：超過 IP_RETENTION_MS 未出現的 IP 會被清掉、告警歷史有上限；
   持久化介面讓歷史與封鎖跨重啟還原。
   持久化介面（全回傳 Promise）：
     saveIpBlock({ip, blockedAt, expiresAt, blockedBy})
     deleteIpBlock(ip)
     loadIpBlocks() → [{ip, blockedAt, expiresAt, blockedBy}]
     saveIpHour({ip, t, http, wsMsg, connEvents})
     loadIpHours(from, to) → [{ip, t, http, wsMsg, connEvents}]
     saveIpAlert({id, ip, type, detail, at})
     loadIpAlerts(limit) → [{id, ip, type, detail, at}]
     deleteIpDataOlderThan(cutoff) */

var crypto = require("crypto");

/** 流量歷史保留上限（7 天）。 */
var IP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 異常閥值（每個 IP）：超過即產生告警，供人類判斷是否為攻擊。 */
var IP_ALERT_HTTP_PER_MIN = Number(process.env.IP_ALERT_HTTP_PER_MIN ?? 120);
var IP_ALERT_WS_PER_MIN = Number(process.env.IP_ALERT_WS_PER_MIN ?? 600);
var IP_ALERT_CONN_PER_MIN = Number(process.env.IP_ALERT_CONN_PER_MIN ?? 10);
var IP_ALERT_HTTP_PER_HOUR = Number(process.env.IP_ALERT_HTTP_PER_HOUR ?? 2000);

/** 封鎖時長（ms）；permanent 用 null 表示永不解除。 */
var IP_BLOCK_DURATIONS = {
  "5m": 5 * 60000,
  "30m": 30 * 60000,
  "1h": 60 * 60000,
  "6h": 6 * 60 * 60000,
  "24h": 24 * 60 * 60000,
  "7d": 7 * 24 * 60 * 60000,
};

function isIpBlockDuration(value) {
  return typeof value === "string" &&
    (value === "permanent" || Object.prototype.hasOwnProperty.call(IP_BLOCK_DURATIONS, value));
}

/** 寬鬆的 IP 格式檢查（IPv4 / 縮寫 IPv6），阻擋明顯亂輸入。 */
function looksLikeIp(value) {
  var v = value.trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) {
    return v.split(".").every(function (part) { return Number(part) <= 255; });
  }
  return /^[0-9a-fA-F:]{2,45}$/.test(v) && v.indexOf(":") !== -1;
}

var ALERT_HISTORY_LIMIT = 200;
var MAX_TRACKED_IPS = 5000;

class IpMonitor {
  constructor(persistence) {
    this.persistence = persistence || null;
    this.records = new Map();        // ip → 累計 + 當前分鐘 + 小時桶
    this.concurrent = new Map();     // ip → 目前並連數
    this.blocks = new Map();         // ip → { ip, blockedAt, expiresAt, blockedBy }
    this.alerts = [];                // 新→舊，上限 ALERT_HISTORY_LIMIT
    this.lastPersistAt = 0;
    this.timer = null;
  }

  /* ---- 啟動 / 還原 ---- */

  // 載入既有封鎖名單與警示（重啟後還原）。
  async init() {
    if (!this.persistence) return;
    try {
      var now = Date.now();
      var blocks = await this.persistence.loadIpBlocks();
      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (block.expiresAt !== null && block.expiresAt <= now) {
          this.persistence.deleteIpBlock(block.ip).catch(function () {});
          continue;
        }
        this.blocks.set(block.ip, block);
      }
      this.alerts = (await this.persistence.loadIpAlerts(ALERT_HISTORY_LIMIT))
        .sort(function (a, b) { return b.at - a.at; });
      this.persistence.deleteIpDataOlderThan(now - IP_RETENTION_MS).catch(function () {});
    } catch (error) {
      console.error("ip monitor restore failed", error);
    }
  }

  start(collectIntervalMs = 60000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.collect(), collectIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* ---- 記錄 ---- */

  // 依分鐘累積；跨分鐘時先把上一分鐘收尾（告警 + 摺入小時桶）。
  record(ip, kind, now) {
    var t = Math.floor(now / 60000) * 60000;
    var record = this.records.get(ip);
    if (!record) {
      if (this.records.size >= MAX_TRACKED_IPS) this.prune(now, true);
      record = {
        ip: ip, firstSeen: now, lastSeen: now,
        http: 0, wsMsg: 0, connEvents: 0,
        currentMinute: { t: t, http: 0, wsMsg: 0, conns: 0 },
        hours: new Map(),
      };
      this.records.set(ip, record);
    }
    record.lastSeen = now;
    if (record.currentMinute.t !== t) {
      // 上一分鐘已完整：先評估告警再彙整。
      this.evaluateAlerts(record, record.currentMinute);
      this.foldMinute(record);
      record.currentMinute = { t: t, http: 0, wsMsg: 0, conns: 0 };
    }
    record.currentMinute[kind]++;
    if (kind !== "conns") record[kind]++;
  }

  recordHttp(ip, now = Date.now()) {
    this.record(ip, "http", now);
  }

  recordWsMessage(ip, now = Date.now()) {
    this.record(ip, "wsMsg", now);
  }

  recordWsConnect(ip, now = Date.now()) {
    this.concurrent.set(ip, (this.concurrent.get(ip) || 0) + 1);
    this.record(ip, "conns", now);
    var record = this.records.get(ip);
    if (record) record.connEvents++;
  }

  recordWsDisconnect(ip) {
    var current = this.concurrent.get(ip) || 0;
    if (current <= 1) this.concurrent.delete(ip);
    else this.concurrent.set(ip, current - 1);
  }

  concurrentOf(ip) {
    return this.concurrent.get(ip) || 0;
  }

  /* ---- 分鐘彙整 + 告警 ---- */

  foldMinute(record) {
    var minute = record.currentMinute;
    var hour = Math.floor(minute.t / 3600000) * 3600000;
    var bucket = record.hours.get(hour) || { http: 0, wsMsg: 0, connEvents: 0 };
    bucket.http += minute.http;
    bucket.wsMsg += minute.wsMsg;
    bucket.connEvents += minute.conns;
    record.hours.set(hour, bucket);
    var cutoff = minute.t - IP_RETENTION_MS;
    for (var key of record.hours.keys()) {
      if (key < cutoff) record.hours.delete(key);
    }
  }

  // 每分鐘彙整 + 依閥值產生告警（即時監控）。
  collect(now = Date.now()) {
    var minuteT = Math.floor(now / 60000) * 60000;
    for (var record of this.records.values()) {
      if (record.currentMinute.t !== minuteT) {
        this.evaluateAlerts(record, record.currentMinute);
        this.foldMinute(record);
        record.currentMinute = { t: minuteT, http: 0, wsMsg: 0, conns: 0 };
      }
      if (now - record.lastSeen > IP_RETENTION_MS) this.records.delete(record.ip);
    }
    this.prune(now);
    this.persistHourly(now);
  }

  prune(now, force) {
    if (!force && this.records.size < MAX_TRACKED_IPS) return;
    var cutoff = now - IP_RETENTION_MS;
    for (var entry of this.records) {
      if (entry[1].lastSeen < cutoff) this.records.delete(entry[0]);
    }
    for (var b of this.blocks) {
      if (b[1].expiresAt !== null && b[1].expiresAt <= now) {
        this.blocks.delete(b[0]);
        if (this.persistence) this.persistence.deleteIpBlock(b[0]).catch(function () {});
      }
    }
    this.alerts = this.alerts.filter(function (alert) { return alert.at >= cutoff; });
  }

  evaluateAlerts(record, minute) {
    if (minute.http > IP_ALERT_HTTP_PER_MIN) {
      this.pushAlert(record.ip, "http-flood", "單分鐘 HTTP 請求 " + minute.http + " 次（閥值 " + IP_ALERT_HTTP_PER_MIN + "）", minute.t);
    }
    if (minute.wsMsg > IP_ALERT_WS_PER_MIN) {
      this.pushAlert(record.ip, "ws-flood", "單分鐘 WS 訊息 " + minute.wsMsg + " 則（閥值 " + IP_ALERT_WS_PER_MIN + "）", minute.t);
    }
    if (minute.conns > IP_ALERT_CONN_PER_MIN) {
      this.pushAlert(record.ip, "conn-storm", "單分鐘建立 " + minute.conns + " 條 WS 連線（閥值 " + IP_ALERT_CONN_PER_MIN + "）", minute.t);
    }
    var hour = Math.floor(minute.t / 3600000) * 3600000;
    var bucket = record.hours.get(hour);
    if (bucket && bucket.http > IP_ALERT_HTTP_PER_HOUR) {
      this.pushAlert(record.ip, "http-hourly", "單小時 HTTP 請求 " + bucket.http + " 次（閥值 " + IP_ALERT_HTTP_PER_HOUR + "）", minute.t);
    }
  }

  pushAlert(ip, type, detail, at) {
    // 同一 IP + 同一類型的告警，5 分鐘內只記一筆，避免洗爆告警列表。
    var recent = this.alerts.find(function (alert) {
      return alert.ip === ip && alert.type === type && at - alert.at < 5 * 60000;
    });
    if (recent) return;
    var alert = { id: crypto.randomUUID(), ip: ip, type: type, detail: detail, at: at };
    this.alerts.unshift(alert);
    if (this.alerts.length > ALERT_HISTORY_LIMIT) this.alerts.length = ALERT_HISTORY_LIMIT;
    if (this.persistence) {
      this.persistence.saveIpAlert(alert).catch(function (error) {
        console.error("ip alert persist failed", error);
      });
    }
  }

  persistHourly(now) {
    if (!this.persistence || now - this.lastPersistAt < 5 * 60000) return;
    this.lastPersistAt = now;
    var persistence = this.persistence;
    this.records.forEach(function (record) {
      record.hours.forEach(function (bucket, hour) {
        // 只寫最近兩個小時桶：更早的桶在它們仍是「當下」時就寫過了。
        if (hour >= now - 2 * 3600000) {
          persistence
            .saveIpHour({ ip: record.ip, t: hour, http: bucket.http, wsMsg: bucket.wsMsg, connEvents: bucket.connEvents })
            .catch(function (error) { console.error("ip hour persist failed", error); });
        }
      });
    });
    persistence.deleteIpDataOlderThan(now - IP_RETENTION_MS).catch(function () {});
  }

  /* ---- 查詢 ---- */

  // top N：rangeMs 可用 1h / 24h / 7d（3600000 / 86400000 / 604800000）。
  top(rangeMs, now = Date.now(), limit = 10) {
    var from = now - rangeMs;
    var rows = [];
    for (var record of this.records.values()) {
      var http = 0, wsMsg = 0, connEvents = 0;
      for (var entry of record.hours) {
        if (entry[0] >= from && entry[0] <= now) {
          http += entry[1].http;
          wsMsg += entry[1].wsMsg;
          connEvents += entry[1].connEvents;
        }
      }
      // 視窗內若包含本分鐘，也把進行中的計數算進去。
      if (record.currentMinute.t >= from) {
        http += record.currentMinute.http;
        wsMsg += record.currentMinute.wsMsg;
        connEvents += record.currentMinute.conns;
      }
      if (http === 0 && wsMsg === 0 && connEvents === 0) continue;
      var block = this.blocks.get(record.ip);
      rows.push({
        ip: record.ip,
        http: http,
        wsMsg: wsMsg,
        connEvents: connEvents,
        concurrent: this.concurrentOf(record.ip),
        firstSeen: record.firstSeen,
        lastSeen: record.lastSeen,
        blocked: Boolean(block),
        blockExpiresAt: block ? block.expiresAt : null,
      });
    }
    rows.sort(function (a, b) { return b.http + b.wsMsg - (a.http + a.wsMsg); });
    return rows.slice(0, limit);
  }

  listAlerts() {
    return this.alerts;
  }

  thresholds() {
    return {
      httpPerMin: IP_ALERT_HTTP_PER_MIN,
      wsPerMin: IP_ALERT_WS_PER_MIN,
      connPerMin: IP_ALERT_CONN_PER_MIN,
      httpPerHour: IP_ALERT_HTTP_PER_HOUR,
      retentionDays: 7,
    };
  }

  /* ---- 封鎖 ---- */

  isBlocked(ip, now = Date.now()) {
    var block = this.blocks.get(ip);
    if (!block) return false;
    if (block.expiresAt !== null && block.expiresAt <= now) {
      this.blocks.delete(ip);
      if (this.persistence) this.persistence.deleteIpBlock(ip).catch(function () {});
      return false;
    }
    return true;
  }

  block(ip, duration, blockedBy, now = Date.now()) {
    var expiresAt = duration === "permanent" ? null : now + IP_BLOCK_DURATIONS[duration];
    var block = { ip: ip, blockedAt: now, expiresAt: expiresAt, blockedBy: blockedBy };
    this.blocks.set(ip, block);
    if (this.persistence) {
      this.persistence.saveIpBlock(block).catch(function (error) {
        console.error("ip block persist failed", error);
      });
    }
    return block;
  }

  unblock(ip) {
    var existed = this.blocks.delete(ip);
    if (existed && this.persistence) this.persistence.deleteIpBlock(ip).catch(function () {});
    return existed;
  }

  listBlocks(now = Date.now()) {
    var blocks = [];
    for (var entry of this.blocks) {
      var ip = entry[0], block = entry[1];
      if (block.expiresAt !== null && block.expiresAt <= now) {
        this.blocks.delete(ip);
        if (this.persistence) this.persistence.deleteIpBlock(ip).catch(function () {});
        continue;
      }
      blocks.push(block);
    }
    return blocks.sort(function (a, b) { return b.blockedAt - a.blockedAt; });
  }

  // 測試與除錯用。
  hasRecord(ip) {
    return this.records.has(ip);
  }
}

module.exports = {
  IP_RETENTION_MS: IP_RETENTION_MS,
  IP_ALERT_HTTP_PER_MIN: IP_ALERT_HTTP_PER_MIN,
  IP_ALERT_WS_PER_MIN: IP_ALERT_WS_PER_MIN,
  IP_ALERT_CONN_PER_MIN: IP_ALERT_CONN_PER_MIN,
  IP_ALERT_HTTP_PER_HOUR: IP_ALERT_HTTP_PER_HOUR,
  IP_BLOCK_DURATIONS: IP_BLOCK_DURATIONS,
  isIpBlockDuration: isIpBlockDuration,
  looksLikeIp: looksLikeIp,
  IpMonitor: IpMonitor,
};