"use strict";
/* IpMonitor 行為測試：注入 now + 假持久化，不碰網路。 */

var test = require("node:test");
var assert = require("node:assert");
var mod = require("../ip-monitor.js");

var IpMonitor = mod.IpMonitor;
var IP_ALERT_HTTP_PER_MIN = mod.IP_ALERT_HTTP_PER_MIN;
var IP_ALERT_CONN_PER_MIN = mod.IP_ALERT_CONN_PER_MIN;
var isIpBlockDuration = mod.isIpBlockDuration;
var looksLikeIp = mod.looksLikeIp;

// 假持久化：Map 存封鎖與小時桶，其餘空實作。
function makePersistence() {
  var savedBlocks = new Map();
  var savedHours = new Map();
  var persistence = {
    async saveIpBlock(block) { savedBlocks.set(block.ip, block); },
    async deleteIpBlock(ip) { savedBlocks.delete(ip); },
    async loadIpBlocks() { return Array.from(savedBlocks.values()); },
    async saveIpHour(point) { savedHours.set(point.ip + "_" + point.t, point); },
    async loadIpHours() { return Array.from(savedHours.values()); },
    async saveIpAlert() {},
    async loadIpAlerts() { return []; },
    async deleteIpDataOlderThan() {},
  };
  return { persistence: persistence, savedBlocks: savedBlocks, savedHours: savedHours };
}

test("ip-monitor：http/ws 計數累積並摺入小時桶", () => {
  var monitor = new IpMonitor();
  var now = 1700000000000;
  for (var i = 0; i < 5; i++) {
    monitor.recordHttp("1.2.3.4", now);
  }
  monitor.recordWsMessage("1.2.3.4", now);
  now += 60000; // 新分鐘：上一分鐘被摺疊進小時桶。
  monitor.recordHttp("1.2.3.4", now);
  assert.equal(monitor.hasRecord("1.2.3.4"), true);
  var top = monitor.top(3600000, now);
  assert.equal(top.length, 1);
  assert.equal(top[0].http, 6); // 5 + 1
  assert.equal(top[0].wsMsg, 1);
});

test("ip-monitor：單分鐘 HTTP 超過閥值 → http-flood 告警", () => {
  var monitor = new IpMonitor();
  var now = 1700000000000;
  // 超過閥值（> 閥值）才告警：記錄閥值 + 1 次。
  for (var i = 0; i <= IP_ALERT_HTTP_PER_MIN; i++) {
    monitor.recordHttp("2.3.4.5", now);
  }
  assert.equal(monitor.listAlerts().length, 0);
  now += 60000;
  monitor.recordHttp("2.3.4.5", now); // 收尾上一分鐘 → 觸發告警
  var alerts = monitor.listAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, "http-flood");
});

test("ip-monitor：低於閥值不告警", () => {
  var monitor = new IpMonitor();
  var now = 1700000000000;
  for (var i = 0; i < 10; i++) {
    monitor.recordHttp("3.4.5.6", now);
    monitor.recordWsMessage("3.4.5.6", now);
  }
  now += 60000;
  monitor.recordHttp("3.4.5.6", now);
  assert.equal(monitor.listAlerts().length, 0);
});

test("ip-monitor：同 IP 同類型 5 分鐘內告警去重", () => {
  var monitor = new IpMonitor();
  var now = 1700000000000;
  for (var round = 0; round < 3; round++) {
    for (var i = 0; i < IP_ALERT_HTTP_PER_MIN; i++) {
      monitor.recordHttp("4.5.6.7", now + round * 60000);
    }
    now += 60000;
    monitor.recordHttp("4.5.6.7", now);
  }
  // 3 分鐘內的同一類型告警只記一筆。
  assert.equal(monitor.listAlerts().filter(a => a.type === "http-flood").length, 1);
});

test("ip-monitor：連線暴增 → conn-storm 告警", () => {
  var monitor = new IpMonitor();
  var now = 1700000000000;
  for (var i = 0; i <= IP_ALERT_CONN_PER_MIN; i++) {
    monitor.recordWsConnect("5.6.7.8", now);
    monitor.recordWsDisconnect("5.6.7.8");
  }
  now += 60000;
  monitor.recordHttp("5.6.7.8", now);
  assert.ok(monitor.listAlerts().some(a => a.type === "conn-storm"));
});

test("ip-monitor：多 IP 依流量排序且只取前 10", () => {
  var monitor = new IpMonitor();
  var now = 1700000000000;
  for (var ipIndex = 0; ipIndex < 12; ipIndex++) {
    var ip = "10.0.0." + ipIndex;
    var weight = 12 - ipIndex;
    for (var i = 0; i < weight * 3; i++) {
      monitor.recordHttp(ip, now);
    }
  }
  var top = monitor.top(3600000, now + 60000);
  assert.equal(top.length, 10);
  assert.equal(top[0].ip, "10.0.0.0");
  assert.equal(top[0].http, 36);
});

test("ip-monitor：封鎖、到期自動解除、手動解封", () => {
  var monitor = new IpMonitor();
  var now = 1700000000000;
  monitor.block("6.6.6.6", "5m", "admin@test", now);
  assert.equal(monitor.isBlocked("6.6.6.6", now + 60000), true);
  assert.equal(monitor.isBlocked("6.6.6.6", now + 6 * 60000), false);
  monitor.block("7.7.7.7", "permanent", "admin@test", now);
  assert.equal(monitor.isBlocked("7.7.7.7", now + 365 * 86400000), true);
  assert.equal(monitor.unblock("7.7.7.7"), true);
  assert.equal(monitor.isBlocked("7.7.7.7"), false);
});

test("ip-monitor：透過持久化跨重啟還原封鎖", async () => {
  var fake = makePersistence();
  var monitor = new IpMonitor(fake.persistence);
  monitor.block("8.8.8.8", "permanent", "admin@test");
  await new Promise(resolve => setTimeout(resolve, 0));

  var revived = new IpMonitor(fake.persistence);
  await revived.init();
  assert.equal(revived.isBlocked("8.8.8.8"), true);
});

test("ip-monitor：還原時丟棄已過期的封鎖", async () => {
  var fake = makePersistence();
  var monitor = new IpMonitor(fake.persistence);
  monitor.block("9.9.9.9", "5m", "admin@test");
  await new Promise(resolve => setTimeout(resolve, 0));

  var revived = new IpMonitor(fake.persistence);
  await revived.init();
  assert.equal(revived.isBlocked("9.9.9.9", Date.now() + 10 * 60000), false);
});

test("ip-monitor：isIpBlockDuration / IP_BLOCK_DURATIONS / thresholds", () => {
  assert.equal(isIpBlockDuration("5m"), true);
  assert.equal(isIpBlockDuration("30m"), true);
  assert.equal(isIpBlockDuration("1h"), true);
  assert.equal(isIpBlockDuration("6h"), true);
  assert.equal(isIpBlockDuration("24h"), true);
  assert.equal(isIpBlockDuration("7d"), true);
  assert.equal(isIpBlockDuration("permanent"), true);
  assert.equal(isIpBlockDuration("3h"), false);
  assert.equal(isIpBlockDuration(123), false);
  assert.equal(mod.IP_BLOCK_DURATIONS["1h"], 60 * 60000);
  assert.equal(mod.IP_RETENTION_MS, 7 * 24 * 60 * 60000);
  var t = new IpMonitor().thresholds();
  assert.equal(t.httpPerMin, IP_ALERT_HTTP_PER_MIN);
  assert.equal(t.wsPerMin, mod.IP_ALERT_WS_PER_MIN);
  assert.equal(t.connPerMin, IP_ALERT_CONN_PER_MIN);
  assert.equal(t.httpPerHour, mod.IP_ALERT_HTTP_PER_HOUR);
  assert.equal(t.retentionDays, 7);
});

test("ip-monitor：looksLikeIp 接受 IPv4/IPv6、拒絕亂輸入", () => {
  assert.equal(looksLikeIp("203.0.113.9"), true);
  assert.equal(looksLikeIp("2001:db8::1"), true);
  assert.equal(looksLikeIp("999.1.1.1"), false);
  assert.equal(looksLikeIp("not-an-ip"), false);
});