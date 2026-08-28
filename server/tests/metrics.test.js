"use strict";
/* Metrics（負載指標）行為測試：注入 fake now 與 fake persistence，直接呼叫
   sample()/collect()，不依賴真實計時器。 */

var test = require("node:test");
var assert = require("node:assert");
var metricsMod = require("../metrics.js");
var Metrics = metricsMod.Metrics;
var dayKey = metricsMod.dayKey;

function makeGauge(overrides) {
  var base = { players: 0, spectators: 0, lobby: 0, roomsPlaying: 0, roomsWaiting: 0 };
  return function () { return Object.assign({}, base, overrides || {}); };
}

test("metrics：關閉分鐘桶時統計 http/wsMsg 與 gauge 峰值", function () {
  var now = 1700000000000; // 同一分鐘內取樣即可
  var metrics = new Metrics({
    now: function () { return now; },
    gauge: makeGauge({ players: 2, spectators: 1, lobby: 3, roomsPlaying: 2, roomsWaiting: 1 }),
  });
  metrics.recordHttp();
  metrics.recordHttp();
  metrics.recordWsMessage();
  metrics.recordWsMessage();
  metrics.recordWsMessage();
  metrics.sample();
  metrics.sample();

  now += 60000;
  metrics.collect(now);

  var buckets = metrics.seriesMinute(0, now);
  assert.equal(buckets.length, 1);
  var bucket = buckets[0];
  assert.equal(bucket.http, 2);
  assert.equal(bucket.wsMsg, 3);
  assert.equal(bucket.connPeak, 6); // 2 玩家 + 1 旁觀 + 3 大廳
  assert.equal(bucket.playersPeak, 2);
  assert.equal(bucket.roomsPlayingPeak, 2);
  assert.ok(bucket.rssPeak > 0);
  metrics.stop(); // 關閉 event-loop delay monitor，避免測試 process 不結束
});

test("metrics：分鐘桶彙總成小時點並寫入 persistence", async function () {
  var saved = [];
  var persistence = {
    saveHour: async function (point) { saved.push(point); },
    loadHours: async function () { return saved; },
  };
  // XX:59:00 → 一個落在 H 小時內的分鐘桶；XX+2 分 → 關閉並彙總 H 小時。
  var now = 1700000000000; // 2023-11-14 22:13:20 UTC
  now = now - (now % 600000) + 3540000; // 對齊到某小時的第 59 分 00 秒
  var metrics = new Metrics({
    now: function () { return now; },
    gauge: makeGauge({ players: 4, roomsPlaying: 3 }),
    persistence: persistence,
  });
  metrics.recordWsMessage();
  metrics.sample();
  now += 120000; // XX+1 小時的 01 分
  metrics.collect(now);

  assert.equal(saved.length, 1);
  assert.equal(saved[0].wsMsg, 1);
  assert.equal(saved[0].playersPeak, 4);
  assert.equal(saved[0].samples, 1);

  var hours = await metrics.seriesHour(saved[0].t, saved[0].t);
  assert.equal(hours.length, 1);
  metrics.stop();
});

test("metrics：每日彙總採亞洲/台北（UTC+8）日界", async function () {
  var hours = new Map();
  // 2023-11-14 17:00 UTC = 2023-11-15 01:00 台北 → 日鍵 2023-11-15。
  var taipeiLateNight = Date.UTC(2023, 10, 14, 17, 0, 0);
  var taipeiEvening = Date.UTC(2023, 10, 14, 12, 0, 0); // 台北 20:00，同一天
  hours.set(taipeiLateNight, {
    t: taipeiLateNight,
    samples: 60, http: 120, wsMsg: 600, connPeak: 8, connSum: 240,
    playersPeak: 6, spectatorsPeak: 2, lobbyPeak: 2, roomsPlayingPeak: 3, roomsWaitingPeak: 1,
    lagP95Max: 5, lagMax: 9, cpuPeak: 42.5, cpuSum: 1200, rssPeak: 300000000, heapPeak: 100000000,
  });
  hours.set(taipeiEvening, {
    t: taipeiEvening,
    samples: 60, http: 80, wsMsg: 400, connPeak: 5, connSum: 180,
    playersPeak: 4, spectatorsPeak: 1, lobbyPeak: 1, roomsPlayingPeak: 2, roomsWaitingPeak: 0,
    lagP95Max: 4, lagMax: 6, cpuPeak: 18.2, cpuSum: 600, rssPeak: 250000000, heapPeak: 90000000,
  });
  var persistence = {
    saveHour: async function () {},
    loadHours: async function (from, to) {
      return Array.from(hours.values()).filter(function (p) { return p.t >= from && p.t <= to; });
    },
  };
  var metrics = new Metrics({ persistence: persistence });
  var days = await metrics.seriesDay(taipeiEvening - 1, taipeiLateNight + 1);
  // 台北 11-14 的 20:00 與 11-15 的 01:00 屬不同天。
  assert.equal(days.length, 2);
  var evening = days.find(function (d) { return d.day === "2023-11-14"; });
  var lateNight = days.find(function (d) { return d.day === "2023-11-15"; });
  assert.equal(evening.http, 80);
  assert.equal(evening.wsMsg, 400);
  assert.equal(evening.connPeak, 5);
  assert.equal(evening.cpuPeak, 18.2);
  assert.equal(lateNight.http, 120);
  assert.equal(lateNight.wsMsg, 600);
  assert.equal(lateNight.connPeak, 8);
  assert.equal(lateNight.cpuPeak, 42.5);
  metrics.stop();
});

test("metrics：live 快照來自 gauge provider", function () {
  var metrics = new Metrics({ gauge: makeGauge({ players: 2, spectators: 3, lobby: 1, roomsPlaying: 2, roomsWaiting: 1 }) });
  metrics.sample();
  metrics.sample();
  var live = metrics.live();
  assert.equal(live.players, 2);
  assert.equal(live.spectators, 3);
  assert.equal(live.roomsPlaying, 2);
  assert.equal(live.roomsWaiting, 1);
  assert.ok(live.rssMb > 0);
  // CPU 取樣過兩次後應有數值，且介於 0–100。
  assert.ok(live.cpuPct >= 0);
  assert.ok(live.cpuPct <= 100);
  metrics.stop();
});

test("metrics：dayKey 採亞洲/台北（UTC+8）", function () {
  assert.equal(dayKey(Date.UTC(2023, 10, 14, 16, 0, 0)), "2023-11-15");
  assert.equal(dayKey(Date.UTC(2023, 10, 14, 15, 59, 0)), "2023-11-14");
});

test("metrics：start/stop 管理 sample 與 collect 計時器", function () {
  var metrics = new Metrics({});
  metrics.start(60000, 5000);
  assert.ok(metrics.samplerTimer, "start 後應有 sample 計時器");
  assert.ok(metrics.collectTimer, "start 後應有 collect 計時器");
  var firstCollectTimer = metrics.collectTimer;
  metrics.start(60000, 5000); // 重複 start 不會重複排程
  assert.strictEqual(metrics.collectTimer, firstCollectTimer);
  metrics.stop();
  assert.strictEqual(metrics.samplerTimer, null);
  assert.strictEqual(metrics.collectTimer, null);
});