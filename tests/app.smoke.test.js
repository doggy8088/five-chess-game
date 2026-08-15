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
    arc() {}, arcTo() {}, closePath() {}, fillText() {},
    createLinearGradient() { return this._grad; },
    createRadialGradient() { return this._grad; }
    };
  c.getContext = function () { return ctx; };
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
  diffButtons.forEach((b) => { b.setAttribute("data-diff", "easy"); b.setAttribute("aria-pressed", "false"); });

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
  click(FB, 3, 3, W, H);        // 第 3 黑
  await sleep(330);             // AI 第 3 白
  assert.equal(stones.textContent, "6 / 225");
  DOM.getElementById("btn-undo").dispatch("click");
  assert.equal(stones.textContent, "4 / 225", "撤兩手回到 4 子");
});

test("app 切換模式：對戰 AI ↔ 雙人類", () => {
  DOM.getElementById("btn-mode").dispatch("click");
  assert.equal(mode.textContent, "雙人類");
  DOM.getElementById("btn-mode").dispatch("click");
  assert.equal(mode.textContent, "對戰 AI（困難）");
});

test("app 新局：清空棋子、隱藏浮層", () => {
  DOM.getElementById("btn-new").dispatch("click");
  assert.equal(stones.textContent, "0 / 225");
  assert.equal(overlay.classList.contains("show"), false);
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

  // 悔棋退回已記錄的結果
  DOM.getElementById("btn-undo").dispatch("click");
  assert.equal(winrate.textContent, "–", "悔棋後勝率還原");
  assert.equal(streak.textContent, "0", "悔棋後連勝還原");
  assert.equal(API.stats.wins, 0);
  await sleep(330);   // 等悔棋後觸發的 AI 落子完成
});
