"use strict";
/* 伺服器負載指標（Metrics）。
   分鐘解析度的桶存在記憶體（保留 72 小時）；小時彙總另透過選配的 persistence
   （saveHour/loadHours）落地，讓每小時與每日趨勢在重新部署後仍可查詢。
   日界採亞洲/台北（UTC+8）。
   匯出：Metrics、dayKey(t)。
   opts: { now?: () => ms, gauge?: () => GaugeSample, persistence?: { saveHour(point), loadHours(from, to) } }
   MinuteBucket：{ t, http, wsMsg, connPeak, connAvg, playersPeak, spectatorsPeak,
     lobbyPeak, roomsPlayingPeak, roomsWaitingPeak, lagP95, lagMax, cpuAvg, cpuPeak,
     rssPeak, heapPeak }
   HourPoint：{ t, samples, http, wsMsg, connPeak, connSum, playersPeak,
     spectatorsPeak, lobbyPeak, roomsPlayingPeak, roomsWaitingPeak, lagP95Max,
     lagMax, cpuPeak, cpuSum, rssPeak, heapPeak }
   GaugeSample：{ players, spectators, lobby, roomsPlaying, roomsWaiting } */

var perfHooks = require("node:perf_hooks");
var monitorEventLoopDelay = perfHooks.monitorEventLoopDelay;

var MINUTE_RETENTION_MS = 72 * 60 * 60 * 1000;    // 分鐘桶記憶體保留 72 小時
var HOUR_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 小時點保留 90 天
var TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;        // UTC+8

function minuteStart(t) {
  return Math.floor(t / 60000) * 60000;
}

function hourStart(t) {
  return Math.floor(t / 3600000) * 3600000;
}

// 以台北日界（UTC+8）算出 'YYYY-MM-DD' 日鍵
function dayKey(t) {
  return new Date(t + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

function percentile95(samples) {
  if (samples.length === 0) return 0;
  var sorted = samples.slice().sort(function (a, b) { return a - b; });
  var index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  var value = sorted[index];
  return typeof value === "number" ? value : 0;
}

class Metrics {
  constructor(opts) {
    this.opts = opts || {};
    this.minutes = new Map();    // 分鐘起點(ms) -> MinuteBucket
    this.hours = new Map();      // 小時起點(ms) -> HourPoint
    this.current = this._newPartial(this._now());
    this.lastUpsert = 0;
    this.delayMonitor = null;
    this.samplerTimer = null;
    this.collectTimer = null;
    this.lastLagMs = 0;
    this.lastCpuPct = 0;
    this.lastCpuSample = null;   // { usage, at }
    if (typeof monitorEventLoopDelay === "function") {
      this.delayMonitor = monitorEventLoopDelay({ resolution: 20 });
      this.delayMonitor.enable();
    }
  }

  _now() {
    return typeof this.opts.now === "function" ? this.opts.now() : Date.now();
  }

  _gauge() {
    if (typeof this.opts.gauge === "function") return this.opts.gauge();
    return { players: 0, spectators: 0, lobby: 0, roomsPlaying: 0, roomsWaiting: 0 };
  }

  /* ---- 記錄 ---- */

  recordHttp() { this.current.http++; }

  recordWsMessage() { this.current.wsMsg++; }

  /* ---- 週期 ---- */

  // 啟動 lag 取樣器與每分鐘收集計時器（預設 5 秒取樣 / 60 秒收集）
  start(collectIntervalMs, sampleIntervalMs) {
    if (this.collectTimer) return;
    collectIntervalMs = collectIntervalMs || 60000;
    sampleIntervalMs = sampleIntervalMs || 5000;
    var self = this;
    this.samplerTimer = setInterval(function () { self.sample(); }, sampleIntervalMs);
    if (this.samplerTimer.unref) this.samplerTimer.unref();
    this.collectTimer = setInterval(function () { self.collect(); }, collectIntervalMs);
    if (this.collectTimer.unref) this.collectTimer.unref();
  }

  stop() {
    if (this.samplerTimer) clearInterval(this.samplerTimer);
    if (this.collectTimer) clearInterval(this.collectTimer);
    this.samplerTimer = null;
    this.collectTimer = null;
    if (this.delayMonitor) this.delayMonitor.disable();
  }

  _newPartial(t) {
    return { t: minuteStart(t), http: 0, wsMsg: 0, lagSamples: [], gauges: [], rssPeak: 0, heapPeak: 0, cpuSum: 0, cpuPeak: 0, cpuSamples: 0 };
  }

  // 取一次 gauge + 記憶體 + CPU + lag 樣本，記入當前分鐘
  sample() {
    var now = this._now();
    if (minuteStart(now) !== this.current.t) this.collect(now);
    this.current.gauges.push(this._gauge());
    var memory = process.memoryUsage();
    this.current.rssPeak = Math.max(this.current.rssPeak, memory.rss);
    this.current.heapPeak = Math.max(this.current.heapPeak, memory.heapUsed);
    this._sampleCpu();
    this._recordLag();
  }

  // CPU 使用率：兩次取樣間的 CPU 時間 ÷ 真實經過時間（單一 vCPU 為 100%）
  _sampleCpu() {
    var usage = process.cpuUsage();
    var realNow = Date.now();
    if (this.lastCpuSample) {
      var wallMs = Math.max(1, realNow - this.lastCpuSample.at);
      var cpuUsec = usage.user - this.lastCpuSample.usage.user + (usage.system - this.lastCpuSample.usage.system);
      this.lastCpuPct = Math.min(100, Math.max(0, (cpuUsec / (wallMs * 1000)) * 100));
      this.current.cpuSum += this.lastCpuPct;
      this.current.cpuPeak = Math.max(this.current.cpuPeak, this.lastCpuPct);
      this.current.cpuSamples++;
    }
    this.lastCpuSample = { usage: usage, at: realNow };
  }

  _recordLag() {
    if (!this.delayMonitor) return;
    var meanNs = this.delayMonitor.mean;
    if (Number.isFinite(meanNs) && meanNs > 0) {
      var lagMs = meanNs / 1000000;
      this.lastLagMs = lagMs;
      this.current.lagSamples.push(lagMs);
    }
    this.delayMonitor.reset();
  }

  // 關閉當前分鐘桶並彙總進小時點
  collect(nowOverride) {
    var now = typeof nowOverride === "number" ? nowOverride : this._now();
    var bucketStart = minuteStart(now);
    var partial = this.current;
    if (bucketStart !== partial.t) {
      var gauges = partial.gauges;
      var connValues = gauges.map(function (g) { return g.players + g.spectators + g.lobby; });
      var bucket = {
        t: partial.t,
        http: partial.http,
        wsMsg: partial.wsMsg,
        connPeak: connValues.length > 0 ? Math.max.apply(null, connValues) : 0,
        connAvg: connValues.length > 0 ? connValues.reduce(function (sum, v) { return sum + v; }, 0) / connValues.length : 0,
        playersPeak: gauges.length > 0 ? Math.max.apply(null, gauges.map(function (g) { return g.players; })) : 0,
        spectatorsPeak: gauges.length > 0 ? Math.max.apply(null, gauges.map(function (g) { return g.spectators; })) : 0,
        lobbyPeak: gauges.length > 0 ? Math.max.apply(null, gauges.map(function (g) { return g.lobby; })) : 0,
        roomsPlayingPeak: gauges.length > 0 ? Math.max.apply(null, gauges.map(function (g) { return g.roomsPlaying; })) : 0,
        roomsWaitingPeak: gauges.length > 0 ? Math.max.apply(null, gauges.map(function (g) { return g.roomsWaiting; })) : 0,
        lagP95: percentile95(partial.lagSamples),
        lagMax: partial.lagSamples.length > 0 ? Math.max.apply(null, partial.lagSamples) : 0,
        cpuAvg: partial.cpuSamples > 0 ? partial.cpuSum / partial.cpuSamples : 0,
        cpuPeak: partial.cpuPeak,
        rssPeak: partial.rssPeak,
        heapPeak: partial.heapPeak,
      };
      this.minutes.set(bucket.t, bucket);
      this._rollupHour(bucket.t);
      var cutoff = now - MINUTE_RETENTION_MS;
      var self = this;
      this.minutes.forEach(function (b, key) { if (key < cutoff) self.minutes.delete(key); });
      this.current = this._newPartial(now);
    } else {
      // 同分鐘收集：只走 upsert 路徑合併計數
      this._rollupHour(bucketStart);
    }
    this._maybeUpsertHour(now);
  }

  _rollupHour(minuteStartMs) {
    var self = this;
    var hour = hourStart(minuteStartMs);
    var buckets = [];
    this.minutes.forEach(function (b) {
      if (b.t >= hour && b.t < hour + 3600000) buckets.push(b);
    });
    if (buckets.length === 0) return;
    var point = {
      t: hour,
      samples: buckets.length,
      http: buckets.reduce(function (sum, b) { return sum + b.http; }, 0),
      wsMsg: buckets.reduce(function (sum, b) { return sum + b.wsMsg; }, 0),
      connPeak: Math.max.apply(null, buckets.map(function (b) { return b.connPeak; })),
      connSum: buckets.reduce(function (sum, b) { return sum + b.connAvg; }, 0),
      playersPeak: Math.max.apply(null, buckets.map(function (b) { return b.playersPeak; })),
      spectatorsPeak: Math.max.apply(null, buckets.map(function (b) { return b.spectatorsPeak; })),
      lobbyPeak: Math.max.apply(null, buckets.map(function (b) { return b.lobbyPeak; })),
      roomsPlayingPeak: Math.max.apply(null, buckets.map(function (b) { return b.roomsPlayingPeak; })),
      roomsWaitingPeak: Math.max.apply(null, buckets.map(function (b) { return b.roomsWaitingPeak; })),
      lagP95Max: Math.max.apply(null, buckets.map(function (b) { return b.lagP95; })),
      lagMax: Math.max.apply(null, buckets.map(function (b) { return b.lagMax; })),
      cpuPeak: Math.max.apply(null, buckets.map(function (b) { return b.cpuPeak; })),
      cpuSum: buckets.reduce(function (sum, b) { return sum + b.cpuAvg; }, 0),
      rssPeak: Math.max.apply(null, buckets.map(function (b) { return b.rssPeak; })),
      heapPeak: Math.max.apply(null, buckets.map(function (b) { return b.heapPeak; })),
    };
    var existing = this.hours.get(hour);
    this.hours.set(hour, point);
    // 小時內容有變才寫 store，避免頻繁打 persistence
    if (this.opts.persistence && (!existing || existing.http !== point.http || existing.connPeak !== point.connPeak || existing.samples !== point.samples)) {
      this.opts.persistence.saveHour(point).catch(function (error) {
        console.error("metrics hour persist failed", error);
      });
    }
    var cutoff = hourStart(this._now()) - HOUR_RETENTION_MS;
    this.hours.forEach(function (p, key) {
      if (key < cutoff) self.hours.delete(key);
    });
  }

  // 讓進行中的小時在儀表板上保持新鮮，但以 5 分鐘節流
  _maybeUpsertHour(now) {
    if (now - this.lastUpsert < 5 * 60000) return;
    this.lastUpsert = now;
    this._rollupHour(minuteStart(now));
  }

  /* ---- 查詢 ---- */

  live() {
    var gauge = this._gauge();
    var memory = process.memoryUsage();
    return Object.assign({}, gauge, {
      lagMs: Math.round(this.lastLagMs * 10) / 10,
      cpuPct: Math.round(this.lastCpuPct * 10) / 10,
      rssMb: Math.round((memory.rss / 1048576) * 10) / 10,
      heapMb: Math.round((memory.heapUsed / 1048576) * 10) / 10,
      uptimeSec: Math.round(process.uptime()),
    });
  }

  seriesMinute(from, to) {
    var out = [];
    this.minutes.forEach(function (bucket) {
      if (bucket.t >= from && bucket.t <= to) out.push(bucket);
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  async seriesHour(from, to) {
    var map = new Map();
    this.hours.forEach(function (point, t) {
      if (t >= from && t <= to) map.set(t, point);
    });
    if (this.opts.persistence) {
      try {
        var stored = await this.opts.persistence.loadHours(from, to);
        for (var i = 0; i < stored.length; i++) {
          var point = stored[i];
          var existing = map.get(point.t);
          if (!existing || point.samples > existing.samples) map.set(point.t, point);
        }
      } catch (error) {
        console.error("metrics hour load failed", error);
      }
    }
    var out = Array.from(map.values());
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  async seriesDay(from, to) {
    var hours = await this.seriesHour(from, to);
    var byDay = new Map();
    for (var i = 0; i < hours.length; i++) {
      var point = hours[i];
      var day = dayKey(point.t);
      var acc = byDay.get(day);
      if (!acc) {
        acc = { day: day, t: point.t, samples: 0, http: 0, wsMsg: 0, connPeak: 0, connSum: 0, playersPeak: 0, spectatorsPeak: 0, lobbyPeak: 0, roomsPlayingPeak: 0, roomsWaitingPeak: 0, lagP95Max: 0, lagMax: 0, cpuPeak: 0, cpuSum: 0, rssPeak: 0, heapPeak: 0 };
        byDay.set(day, acc);
      }
      acc.samples += point.samples;
      acc.http += point.http;
      acc.wsMsg += point.wsMsg;
      acc.connPeak = Math.max(acc.connPeak, point.connPeak);
      acc.connSum += point.connSum;
      acc.playersPeak = Math.max(acc.playersPeak, point.playersPeak);
      acc.spectatorsPeak = Math.max(acc.spectatorsPeak, point.spectatorsPeak);
      acc.lobbyPeak = Math.max(acc.lobbyPeak, point.lobbyPeak);
      acc.roomsPlayingPeak = Math.max(acc.roomsPlayingPeak, point.roomsPlayingPeak);
      acc.roomsWaitingPeak = Math.max(acc.roomsWaitingPeak, point.roomsWaitingPeak);
      acc.lagP95Max = Math.max(acc.lagP95Max, point.lagP95Max);
      acc.lagMax = Math.max(acc.lagMax, point.lagMax);
      acc.cpuPeak = Math.max(acc.cpuPeak, point.cpuPeak);
      acc.cpuSum += point.cpuSum;
      acc.rssPeak = Math.max(acc.rssPeak, point.rssPeak);
      acc.heapPeak = Math.max(acc.heapPeak, point.heapPeak);
      byDay.set(day, acc);
    }
    var out = Array.from(byDay.values());
    out.sort(function (a, b) { return a.day.localeCompare(b.day); });
    return out;
  }
}

module.exports = { Metrics: Metrics, dayKey: dayKey };