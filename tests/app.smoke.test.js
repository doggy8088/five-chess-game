"use strict";
/* =====================================================================
 * 五子棋 — 控制器整合測試 (headless, 無 DOM/three.js)
 * 用最小 DOM 偽件啟動真正的 app.js，走 2D 備援路徑，
 * 驗證：落子、AI 回應、undo、切換模式、新局、勝負浮層等連線邏輯。
 * 執行： node --test tests/*.test.js
 * ===================================================================== */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const G = require("../game.js");

// ---- 最小 2D 內容器偽件 ----
function makeEl() {
  var e = { style: {}, _attrs: {}, textContent: "", disabled: false, events: {} };
  var set = new Set();
  e.classList = { add: (x) => set.add(x), remove: (x) => set.delete(x), contains: (x) => set.has(x) };
  e.setAttribute = function (k, v) { e._attrs[k] = String(v); };
  e.getAttribute = function (k) { return e._attrs[k] == null ? null : e._attrs[k]; };
  e.addEventListener = function (t, fn) { (e.events[t] = e.events[t] || []).push(fn); };
  e.dispatch = function (t, ev) { (e.events[t] || []).forEach((f) => f(ev || {})); };
  return e;
}

function makeCanvas(rect) {
  var c = makeEl();
  c.width = 800; c.height = 800;
  c.getBoundingClientRect = function () { return { left: 0, top: 0, width: rect.w, height: rect.h }; };
  var ctx = {
    _grad: { addColorStop() {} },
    setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc() {}, arcTo() {}, closePath() {},
    fillText(text, x, y) {
      this._numberDraws++;
      this._fillTexts.push(String(text));
      this._fillCalls.push({ text: String(text), x: x, y: y });
    },
    measureText(text) { return { width: String(text).length * 16 }; },
    strokeText() {}, drawImage() {}, _numberDraws: 0, _fillTexts: [], _fillCalls: [],
    createLinearGradient() { return this._grad; },
    createRadialGradient() { return this._grad; }
    };
  c.getContext = function () { return ctx; };
  c._ctx = ctx;
  return c;
}

function installDom(innerW, innerH) {
  var registry = {};
  function byId(id) {
    if (!registry[id]) {
      registry[id] = (id === "gl" || id === "fallback") ? makeCanvas({ w: innerW, h: innerH }) : makeEl();
      }
    return registry[id];
    }
  var diffButtons = [makeEl(), makeEl(), makeEl()];
  diffButtons.forEach((b, i) => { b.setAttribute("data-diff", ["easy", "medium", "hard"][i]); b.setAttribute("aria-pressed", "false"); });
  var sideButtons = [makeEl(), makeEl()];
  sideButtons.forEach((b, i) => { b.setAttribute("data-side", ["black", "white"][i]); b.setAttribute("aria-pressed", i === 0 ? "true" : "false"); });

  global.window = {
    Game: require("../game.js"),
    innerWidth: innerW, innerHeight: innerH, devicePixelRatio: 1,
    events: {},
    addEventListener(t, fn) { (this.events[t] = this.events[t] || []).push(fn); },
    dispatchResize() { (this.events.resize || []).forEach((f) => f()); }
    };
  var store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
    };
  global.document = {
    readyState: "complete",
    getElementById: byId,
    querySelectorAll(sel) {
      if (sel.indexOf("data-diff") !== -1) return diffButtons;
      if (sel.indexOf("data-side") !== -1) return sideButtons;
      return [];
        },
    createElement(tag) { return tag === "canvas" ? makeCanvas({ w: innerW, h: innerH }) : makeEl(); },
    addEventListener() {}
    };
  global.requestAnimationFrame = function () { return 0; };
  global.cancelAnimationFrame = function () {};
}

function coords(gx, gy, innerW, innerH) {
  var cell = Math.min((innerW - 90) / 14, (innerH - 90) / 14);
  var pad = (innerW - cell * 14) / 2;
  return { x: pad + gx * cell, y: pad + gy * cell };
}
function click(view, gx, gy, W, H) { var c = coords(gx, gy, W, H); view.dispatch("pointerdown", { clientX: c.x, clientY: c.y, buttons: 0 }); }
function setDiff(d) {
  var btn = DOM.querySelectorAll(".seg [data-diff]").find((b) => b.getAttribute("data-diff") === d);
  btn.dispatch("click");
}
function setSide(s) {
  var btn = DOM.querySelectorAll(".seg [data-side]").find((b) => b.getAttribute("data-side") === s);
  btn.dispatch("click");
}

const W = 800, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 啟動真實 app.js，捕獲 boot 階段排程的定時器避免 process 掛起
const realSetTimeout = global.setTimeout;
let queue = [];
global.setTimeout = function (fn) { queue.push(fn); return 1; };
installDom(W, H);
require("../app.js");           // 觸發 boot()（同步）
global.setTimeout = realSetTimeout; // 還原；AI 動作改用真實 setTimeout
const DOM = global.document;
const FB = DOM.getElementById("fallback");
const stones = DOM.getElementById("s-stones");
const status = DOM.getElementById("s-status");
const mode = DOM.getElementById("s-mode");
const overlay = DOM.getElementById("overlay");

test("app 啟動：預設 2D 路徑、黑棋先手、未結束", () => {
  assert.equal(stones.textContent, "0 / 225");
  assert.equal(status.textContent, "進行中");
  assert.equal(mode.textContent, "對戰 AI（困難）");
  assert.equal(DOM.getElementById("zoom-value").textContent, "100%");
  assert.equal(overlay.classList.contains("show"), false);
});

test("app 落子 → AI 回應，子數 +2", async () => {
  click(FB, 7, 7, W, H);        // 黑落 (7,7)
  assert.equal(stones.textContent, "1 / 225", "黑落一子");
  await sleep(330);             // 等 AI（230ms）落子
  assert.equal(stones.textContent, "2 / 225", "AI 回應一子");
});

test("app 第二手黑棋 → AI 再回應，子數 +2", async () => {
  click(FB, 11, 11, W, H);
  assert.equal(stones.textContent, "3 / 225");
  await sleep(330);
  assert.equal(stones.textContent, "4 / 225");
});

test("app undo：撤銷最後黑白各一手", async () => {
  setDiff("easy");              // 簡單：撤銷無次數限制
  click(FB, 3, 3, W, H);        // 第 3 黑
  await sleep(330);             // AI 第 3 白
  assert.equal(stones.textContent, "6 / 225");
  DOM.getElementById("btn-undo").dispatch("click");
  assert.equal(stones.textContent, "4 / 225", "撤兩手回到 4 子");
});

test("app 撤銷限制：中等最多 1 次、困難禁用、簡單無限制", async () => {
  var undoBtn = DOM.getElementById("btn-undo");

  // 困難：禁用撤銷
  setDiff("hard");
  DOM.getElementById("btn-new").dispatch("click");
  click(FB, 7, 7, W, H);
  await sleep(330);
  assert.equal(stones.textContent, "2 / 225");
  assert.equal(undoBtn.disabled, true, "困難模式撤銷按鈕禁用");
  undoBtn.dispatch("click");
  assert.equal(stones.textContent, "2 / 225", "困難模式點擊撤銷無效");

  // 中等：最多 1 次
  setDiff("medium");
  DOM.getElementById("btn-new").dispatch("click");
  click(FB, 7, 7, W, H);
  await sleep(330);
  assert.equal(stones.textContent, "2 / 225");
  assert.equal(undoBtn.disabled, false, "中等模式首次撤銷可用");
  undoBtn.dispatch("click");
  assert.equal(stones.textContent, "0 / 225", "中等模式撤銷成功");
  assert.equal(undoBtn.disabled, true, "中等模式用過 1 次後禁用");
  undoBtn.dispatch("click");
  assert.equal(stones.textContent, "0 / 225", "中等模式第二次撤銷無效");

  // 簡單：無次數限制
  setDiff("easy");
  DOM.getElementById("btn-new").dispatch("click");
  click(FB, 7, 7, W, H);
  await sleep(330);
  click(FB, 0, 0, W, H); // 避開簡單 AI 的中心附近隨機落點，避免測試碰撞
  await sleep(330);
  assert.equal(stones.textContent, "4 / 225");
  undoBtn.dispatch("click");
  assert.equal(stones.textContent, "2 / 225", "簡單模式第一次撤銷");
  undoBtn.dispatch("click");
  assert.equal(stones.textContent, "0 / 225", "簡單模式第二次撤銷仍可用");
  await sleep(330);   // 等第一次撤銷後排程的 AI 落子完成
});

test("app 切換模式：對戰 AI ↔ 雙人類", () => {
  setDiff("hard");              // 還原難度，避免受前測影響
  DOM.getElementById("btn-mode").dispatch("click");
  assert.equal(mode.textContent, "雙人類");
  DOM.getElementById("btn-mode").dispatch("click");
  assert.equal(mode.textContent, "對戰 AI（困難）");
});

test("app 棋盤縮放控制：更新縮放比例顯示", () => {
  var range = DOM.getElementById("zoom-range");
  var value = DOM.getElementById("zoom-value");
  range.value = "120";
  range.dispatch("input");
  assert.equal(value.textContent, "120%");
  range.value = "30";
  range.dispatch("input");
  assert.equal(value.textContent, "30%", "支援縮小至 30% 以完整適配行動版螢幕寬度");
  range.value = "100";
  range.dispatch("input");
  assert.equal(value.textContent, "100%");
});

test("app 設定：記憶最後選擇的難度、縮放比例、執子陣營與棋盤鎖定", () => {
  var range = DOM.getElementById("zoom-range");
  setDiff("easy");
  range.value = "30";
  range.dispatch("input");
  assert.deepEqual(JSON.parse(global.localStorage.getItem("gomoku-settings-v1")), {
    difficulty: "easy", zoom: 30, playerSide: "black", boardViewLocked: false,
    boardView: { theta: 0.6, phi: 0.92 }, boardViewPreset: 0
  });

  setSide("white");
  assert.deepEqual(JSON.parse(global.localStorage.getItem("gomoku-settings-v1")), {
    difficulty: "easy", zoom: 30, playerSide: "white", boardViewLocked: false,
    boardView: { theta: 0.6, phi: 0.92 }, boardViewPreset: 0
  });

  setSide("black");
  setDiff("hard");
  range.value = "100";
  range.dispatch("input");
});

test("app 執子設定：切換執白時 AI 自動下先手黑棋，HUD 顯示輪到白棋（你）", async () => {
  var turnLabel = DOM.getElementById("turn-label");
  setSide("white");
  await sleep(330);
  assert.equal(stones.textContent, "1 / 225", "玩家執白時，AI 先下黑棋第一手");
  assert.equal(global.window.GomokuApp.game.humanPlayer, G.WHITE);
  assert.equal(global.window.GomokuApp.game.aiPlayer, G.BLACK);
  assert.equal(turnLabel.textContent, "輪到白棋（你）");

  // 玩家下第二手（白棋）
  click(FB, 0, 0, W, H);
  await sleep(330);
  assert.equal(stones.textContent, "3 / 225", "玩家下白棋後 AI 再回應黑棋");

  // 還原為執黑
  setSide("black");
  await sleep(330);
  assert.equal(global.window.GomokuApp.game.humanPlayer, G.BLACK);
  assert.equal(stones.textContent, "0 / 225", "切換回執黑後開新局");
});

test("app 新局：清空棋子、隱藏浮層與自動隱藏控制面板", () => {
  var dock = DOM.getElementById("dock");
  var dockOpen = DOM.getElementById("dock-open");
  dock.classList.remove("hidden");
  dockOpen.classList.remove("show");
  DOM.getElementById("btn-new").dispatch("click");
  assert.equal(stones.textContent, "0 / 225");
  assert.equal(overlay.classList.contains("show"), false);
  assert.equal(dock.classList.contains("hidden"), true, "新局自動隱藏面板");
  assert.equal(dockOpen.classList.contains("show"), true, "新局自動顯示右上角開啟鈕");
});

test("app 控制列收合：桌面版可點擊關閉並透過右上角 Icon 重新開啟", () => {
  var dock = DOM.getElementById("dock");
  var dockClose = DOM.getElementById("dock-close");
  var dockOpen = DOM.getElementById("dock-open");

  dock.classList.remove("hidden");
  dockOpen.classList.remove("show");

  dockClose.dispatch("click");
  assert.equal(dock.classList.contains("hidden"), true, "點擊關閉按鈕後控制面板收起");
  assert.equal(dockOpen.classList.contains("show"), true, "控制面板收起後顯示右上角開啟 Icon");

  dockOpen.dispatch("click");
  assert.equal(dock.classList.contains("hidden"), false, "點擊右上角開啟 Icon 後控制面板重新展開");
  assert.equal(dockOpen.classList.contains("show"), false, "控制面板展開後隱藏開啟 Icon");
});

test("app 新局：關閉行動版設定面板", () => {
  var dock = DOM.getElementById("dock");
  var dockOpen = DOM.getElementById("dock-open");
  var originalWidth = window.innerWidth;
  window.innerWidth = 390;
  dock.classList.remove("hidden");
  dockOpen.classList.remove("show");
  DOM.getElementById("btn-new").dispatch("click");
  assert.equal(dock.classList.contains("hidden"), true, "控制列新局會關閉設定面板");
  assert.equal(dockOpen.classList.contains("show"), true, "關閉後顯示設定面板開啟鈕");

  dock.classList.remove("hidden");
  dockOpen.classList.remove("show");
  overlay.classList.add("show");
  DOM.getElementById("ov-new").dispatch("click");
  assert.equal(dock.classList.contains("hidden"), true, "結果看板新局也會關閉設定面板");
  assert.equal(overlay.classList.contains("show"), false, "結果看板新局會關閉結果看板");

  window.innerWidth = originalWidth;
  window.dispatchResize();
});

test("app 行動版結果流程：勝負訊息與新局分享按鈕同步顯示", () => {
  var API = global.window.GomokuApp;
  var turn = DOM.getElementById("turn");
  var originalWidth = window.innerWidth;
  var realSetTimeoutFlow = global.setTimeout;
  var scheduled = [];
  window.innerWidth = 390;
  global.setTimeout = function (fn, delay) {
    scheduled.push({ fn: fn, delay: delay });
    return scheduled.length;
  };

  try {
    API.newGame();
    var g = API.game;
    g.vsAI = false;
    g.place(5, 7, G.BLACK); g.place(6, 7, G.BLACK); g.place(7, 7, G.BLACK);
    g.place(8, 7, G.BLACK); g.place(9, 7, G.BLACK);
    API.finish();
    scheduled[0].fn(); // 延遲顯示結果看板
    assert.equal(overlay.classList.contains("show"), true, "結果訊息顯示於結果看板");
    assert.equal(overlay.classList.contains("message-closed"), false, "結果看板不切換成分離狀態");
    assert.equal(scheduled.some(function (task) { return task.delay === 3000; }), false, "不再排程分段顯示計時器");

    DOM.getElementById("ov-close").dispatch("click");
    assert.equal(overlay.classList.contains("show"), false, "X 關閉結果看板後回到棋盤頁面");
    assert.equal(turn.classList.contains("result-prompt"), true, "棋局結束提示可再次操作");

    turn.dispatch("click");
    assert.equal(overlay.classList.contains("show"), true, "點擊棋局結束可重新開啟結果看板");

    DOM.getElementById("ov-new").dispatch("click");
    assert.equal(overlay.classList.contains("show"), false, "重新開啟後可從結果看板開始新局");
    assert.equal(stones.textContent, "0 / 225", "結果看板的新局按鈕會清空棋盤");
  } finally {
    global.setTimeout = realSetTimeoutFlow;
    window.innerWidth = originalWidth;
    window.dispatchResize();
    API.newGame();
  }
});

// 覆蓋 finish() 路徑：透過公開 API 下成 5 連後結束
test("app 勝負浮層：finish() 設定狀態與浮層", () => {
  var API = global.window.GomokuApp;
  assert.ok(API, "公開 API 已掛上 window");
  API.newGame();
  var g = API.game;
  g.vsAI = false;
  g.place(5, 7, G.BLACK); g.place(6, 7, G.BLACK); g.place(7, 7, G.BLACK);
  g.place(8, 7, G.BLACK); g.place(9, 7, G.BLACK);
  assert.equal(g.winner, G.BLACK);
  API.finish();
  assert.equal(status.textContent, "黑棋勝");
  assert.equal(typeof API.share, "function", "公開分享功能已掛上 window");
  assert.equal(typeof API.download, "function", "公開下載圖片功能已掛上 window");
  assert.equal(typeof API.getShareFilename, "function", "公開取得下載檔名功能已掛上 window");
  var fixedDate = new Date(2026, 7, 18, 21, 45, 0); // 2026-08-18 21:45:00
  var fn = API.getShareFilename(fixedDate);
  assert.equal(fn, "五子棋_20260818_214500_雙人對戰_黑棋獲勝_5手.png", "下載檔名包含日期、時間、模式、結果與手數");
  assert.match(API.getShareFilename(), /^五子棋_\d{8}_\d{6}_雙人對戰_黑棋獲勝_5手\.png$/, "預設時間格式正確");
  assert.equal(typeof API.captureShare, "function", "分享圖片產生功能已掛上 window");
  assert.equal(DOM.getElementById("ov-share").events.click.length, 1, "結果看板已綁定分享按鈕");
  assert.equal(DOM.getElementById("ov-download").events.click.length, 1, "結果看板已綁定下載圖片按鈕");
  var shareCanvas = API.captureShare();
  assert.equal(shareCanvas.width, 1200, "分享圖片使用手機友善的固定寬度");
  assert.equal(shareCanvas.height, 1450, "分享圖片包含完整棋盤與上下資訊區塊");
  assert.ok(shareCanvas._ctx._fillTexts.includes("五子棋 · GOMOKU"), "分享圖片包含遊戲名稱");
  assert.ok(shareCanvas._ctx._fillTexts.includes("1"), "分享圖片包含第一手落子編號");
  assert.ok(shareCanvas._ctx._fillTexts.includes("Made with ❤️ by Will 保哥"), "分享圖片包含指定署名");
  var authorCall = shareCanvas._ctx._fillCalls.find(function (call) { return call.text === "Made with ❤️ by Will 保哥"; });
  assert.ok(authorCall && authorCall.x < shareCanvas.width - 60, "作者資訊完整放在圖片右側內縮區域");
  assert.equal(overlay.classList.contains("show"), false, "X 可關閉結果浮層");
});

test("app 對奕進行中：點擊「輪到黑棋」可開啟對話框並可分享/下載目前盤勢", () => {
  var API = global.window.GomokuApp;
  var turn = DOM.getElementById("turn");
  var ovTitle = DOM.getElementById("ov-title");
  var ovSub = DOM.getElementById("ov-sub");
  var btnNew = DOM.getElementById("ov-new");
  var btnShare = DOM.getElementById("ov-share");
  var btnDownload = DOM.getElementById("ov-download");

  API.newGame();
  assert.equal(API.game.isOver(), false, "遊戲進行中");
  overlay.classList.remove("show");

  turn.dispatch("click");
  assert.equal(overlay.classList.contains("show"), true, "點擊「輪到黑棋」可開啟對話框");
  assert.equal(ovTitle.textContent.includes("輪到黑棋"), true, "對話框標題顯示輪到黑棋");
  assert.equal(ovSub.textContent.includes("對奕進行中"), true, "對話框副標題顯示對奕進行中");
  assert.ok(btnNew, "新局按鈕存在");
  assert.ok(btnShare, "分享按鈕存在");
  assert.ok(btnDownload, "下載按鈕存在");

  var fixedDate = new Date(2026, 7, 18, 22, 25, 0);
  var midGameFilename = API.getShareFilename(fixedDate);
  assert.equal(midGameFilename.includes("輪到黑棋") || midGameFilename.includes("對奕進行中"), true, "進行中下載檔名包含對奕狀態");
});

test("app 落子編號：關閉結果浮層後才顯示", () => {
  var API = global.window.GomokuApp;
  API.newGame();
  if (API.game.vsAI) DOM.getElementById("btn-mode").dispatch("click");
  var before = FB._ctx._numberDraws;
  click(FB, 7, 7, W, H);
  click(FB, 8, 8, W, H);
  assert.equal(FB._ctx._numberDraws, before, "對局進行中不繪製編號");

  var g = API.game;
  g.place(1, 1, G.BLACK); g.place(2, 1, G.BLACK); g.place(3, 1, G.BLACK);
  g.place(4, 1, G.BLACK); g.place(5, 1, G.BLACK);
  assert.equal(g.winner, G.BLACK);
  API.finish();
  overlay.classList.add("show");
  DOM.getElementById("ov-close").dispatch("click");
  assert.ok(FB._ctx._numberDraws > before, "關閉結果浮層後繪製編號");
});

// 勝率／連勝統計：對戰 AI 勝局記錄、悔棋還原（需放在最後，統計為全域狀態）
test("app 統計：勝局記錄勝率與連勝，悔棋還原", async () => {
  var API = global.window.GomokuApp;
  var winrate = DOM.getElementById("s-winrate");
  var streak = DOM.getElementById("s-streak");
  API.newGame();
  API.game.vsAI = true; API.game.humanPlayer = G.BLACK; API.game.aiPlayer = G.WHITE;
  API.refresh();
  assert.equal(winrate.textContent, "–", "無對局時勝率顯示 –");
  assert.equal(streak.textContent, "0", "無對局時連勝 0");

  var g = API.game;
  g.place(5, 7, G.BLACK); g.place(6, 7, G.BLACK); g.place(7, 7, G.BLACK);
  g.place(8, 7, G.BLACK); g.place(9, 7, G.BLACK);
  assert.equal(g.winner, G.BLACK);
  API.finish();
  assert.equal(winrate.textContent, "100%", "勝局後勝率 100%");
  assert.equal(streak.textContent, "1", "勝局後連勝 1");
  assert.equal(API.stats.wins, 1);

  // 悔棋退回已記錄的結果（先切到簡單模式以允許撤銷）
  setDiff("easy");
  DOM.getElementById("btn-undo").dispatch("click");
  assert.equal(winrate.textContent, "–", "悔棋後勝率還原");
  assert.equal(streak.textContent, "0", "悔棋後連勝還原");
  assert.equal(API.stats.wins, 0);
  await sleep(330);   // 等悔棋後觸發的 AI 落子完成
});
