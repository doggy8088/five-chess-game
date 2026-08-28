"use strict";
/* 全站公告測試：發佈成為當前公告、已讀去重、取代生效公告、歷史 50 則上限、
   內容清洗、persistence adapter 保存與還原、persistence 掛掉不影響功能。 */

var test = require("node:test");
var assert = require("node:assert");
var AnnouncementBoard = require("../announcements.js").AnnouncementBoard;

// 模擬 Firestore 文件：同一 id 覆寫整份文件。
function makePersistence() {
  var docs = new Map();
  var persistence = {
    saveAnnouncement: function (record) {
      docs.set(record.id, {
        id: record.id, text: record.text, at: record.at, reached: record.reached,
        acks: Array.from(record.acks)
      });
      return Promise.resolve();
    },
    loadAnnouncements: function () {
      return Promise.resolve(
        Array.from(docs.values())
          .sort(function (a, b) { return b.at - a.at; })
          .slice(0, 50)
          .map(function (record) {
            return { id: record.id, text: record.text, at: record.at, reached: record.reached, acks: new Set(record.acks) };
          })
      );
    }
  };
  return { persistence: persistence, saved: docs };
}

test("公告：發佈後成為當前公告，含觸及人數", () => {
  var board = new AnnouncementBoard();
  var record = board.post("維護公告：今晚 23:00 重啟伺服器", 7, 1000);
  assert.equal(board.current().id, record.id);
  assert.equal(record.text, "維護公告：今晚 23:00 重啟伺服器");
  assert.equal(record.reached, 7);
  assert.deepEqual(board.list()[0], { id: record.id, text: record.text, at: 1000, reached: 7, acks: 0 });
});

test("公告：同一名稱的已讀只記一次，未知 id 與空名稱忽略", () => {
  var board = new AnnouncementBoard();
  var record = board.post("大家好", 5, 1000);
  board.ack(record.id, "阿明");
  board.ack(record.id, "阿明");
  board.ack(record.id, "小美");
  board.ack("no-such-id", "路人");
  board.ack(record.id, "");
  assert.equal(board.list()[0].acks, 2);
});

test("公告：新公告取代生效中的舊公告，舊公告歷史仍可累積已讀", () => {
  var board = new AnnouncementBoard();
  var first = board.post("第一則", 3, 1000);
  var second = board.post("第二則", 4, 2000);
  assert.equal(board.current().id, second.id);
  assert.equal(board.list().length, 2);
  board.ack(first.id, "阿明");
  var firstView = board.list().find(function (entry) { return entry.id === first.id; });
  assert.equal(firstView.acks, 1);
});

test("公告：歷史上限 50 則，最舊的先被擠掉", () => {
  var board = new AnnouncementBoard();
  var oldest = board.post("第 1 則", 0, 1);
  for (var i = 2; i <= 51; i++) board.post("第 " + i + " 則", 0, i);
  assert.equal(board.list().length, 50);
  assert.equal(board.list().some(function (entry) { return entry.id === oldest.id; }), false);
  assert.equal(board.current().text, "第 51 則");
});

test("公告：內容清洗（剝控制字元、trim、上限 500 字）", () => {
  var board = new AnnouncementBoard();
  var record = board.post("  \u0007維護中\u001b ", 1, 1000);
  assert.equal(record.text, "維護中");
  var long = board.post("x".repeat(600), 1, 1000);
  assert.equal(long.text.length, 500);
});

test("公告：經 persistence adapter 保存發佈與已讀，重啟可還原", async () => {
  var fake = makePersistence();
  var board = new AnnouncementBoard(fake.persistence);
  var record = board.post("公告 A", 2, 5000);
  board.ack(record.id, "阿明");
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.deepEqual(fake.saved.get(record.id).acks, ["阿明"]);

  var restored = new AnnouncementBoard(fake.persistence);
  await restored.init();
  assert.equal(restored.current().text, "公告 A");
  assert.equal(restored.list()[0].acks, 1);
});

test("公告：persistence 掛掉不影響公告功能", async () => {
  var persistence = {
    saveAnnouncement: function () { return Promise.reject(new Error("store down")); },
    loadAnnouncements: function () { return Promise.reject(new Error("store down")); }
  };
  var board = new AnnouncementBoard(persistence);
  await board.init();
  var record = board.post("仍可發送", 1, 1000);
  board.ack(record.id, "阿明");
  assert.equal(board.list()[0].acks, 1);
});