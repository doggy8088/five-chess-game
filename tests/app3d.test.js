"use strict";
/* =====================================================================
 * 五子棋 — 3D 路徑測試 (three.js 偽件，headless)
 * 提供極簡 THREE stub，讓真正的 app.js 走 3D 分支並執行一幀動畫，
 * 覆蓋 3D 檢視的建構、拾取、落子動畫、勝局高亮等程式碼路徑。
 * 執行： node --test tests/*.test.js
 * ===================================================================== */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const G = require("../game.js");

// ---------- 極簡 three.js 偽件 ----------
function makeThree() {
  var M = {
    PCFSoftShadowMap: 1,
    DoubleSide: 2,
  };
  M.WebGLRenderer = function () {
    return {
      setPixelRatio() {},
      shadowMap: { enabled: false, type: 0 },
      setSize() {},
      render() {}
       };
    };
  M.Scene = function () {
    var o = { children: [] };
    o.add = function () {};
    return o;
     };
  M.Group = function () {
    var o = { children: [] };
    o.add = function (x) { o.children.push(x); };
    o.remove = function (x) { var i = o.children.indexOf(x); if (i >= 0) o.children.splice(i, 1); };
    return o;
     };
  M.Mesh = function (geo, mat) {
    return {
      position: { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z; } },
      rotation: { x: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z; } },
      geometry: geo, material: mat, userData: {}, children: [],
      receiveShadow: false, castShadow: false, visible: true,
      add: function (x) { this.children.push(x); },
      remove: function () {}
       };
    };
  function materialBase(o) {
    o = o || {};
    this.color = o.color || 0; this.transparent = !!o.transparent;
    this.opacity = o.opacity != null ? o.opacity : 1;
    this.side = o.side;
    this.emissive = o.emissive || 0;
    this.emissiveIntensity = o.emissiveIntensity != null ? o.emissiveIntensity : 1;
    this.roughness = o.roughness; this.metalness = o.metalness;
   }
  M.MeshStandardMaterial = function (o) { materialBase.call(this, o); };
  M.MeshBasicMaterial = function (o) { materialBase.call(this, o); };
  M.AmbientLight = function () { return { position: { set: function () {} } }; };
  M.DirectionalLight = function () {
    return {
      position: { set: function () {} },
      castShadow: false,
      shadow: { mapSize: { set: function () {} }, camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 }, bias: 0 }
       };
    };
  M.BoxGeometry = function () { return {}; };
  M.PlaneGeometry = function () { return {}; };
  M.CylinderGeometry = function () { return {}; };
  M.TorusGeometry = function () { return {}; };
  M.RingGeometry = function () { return {}; };
  M.Plane = function (normal, c) { this.normal = normal; this.constant = c; };
  M.Vector2 = function () { return { x: 0, y: 0 }; };
  M.Vector3 = function () { return { x: 0, y: 0, z: 0 }; };
  M.Raycaster = function () {
    return {
      setFromCamera() {},
      ray: {
        intersectPlane(plane, pt) { pt.x = 0; pt.y = 0; pt.z = 0; return true; }
          }
       };
    };
  M.PerspectiveCamera = function () {
    return {
      position: { x: 0, y: 0, z: 0, set: function () {} },
      aspect: 1,
      lookAt() {},
      updateProjectionMatrix() {}
       };
    };
  M.CanvasTexture = function () { this.anisotropy = 1; };
  return M;
}

// ---------- 最小 DOM 偽件 ----------
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
function makeCanvas() {
  var c = makeEl();
  c.width = 800; c.height = 800;
  c.getBoundingClientRect = function () { return { left: 0, top: 0, width: 800, height: 800 }; };
  c.getContext = function () {
    var ctx = {
      _grad: { addColorStop() {} },
      setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {},
      moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillText() {}, strokeText() {}, arc() {}, arcTo() {}, closePath() {},
      createLinearGradient() { return this._grad; },
      createRadialGradient() { return this._grad; }
       };
    return ctx;
     };
  return c;
}

// 難度按鈕（供查詢 .seg [data-diff] 使用）
var segBtns = ["easy", "medium", "hard"].map(function (d) {
  var b = makeEl(); b.setAttribute("data-diff", d); return b;
});

let rafCb = null;
function installDomFor3D() {
  var registry = {};
  function byId(id) {
    if (!registry[id]) registry[id] = (id === "gl" || id === "fallback") ? makeCanvas() : makeEl();
    return registry[id];
     }
  global.window = {
    THREE: makeThree(),
    Game: require("../game.js"),
    innerWidth: 800, innerHeight: 800, devicePixelRatio: 1,
    events: {}, addEventListener(t, fn) { (this.events[t] = this.events[t] || []).push(fn); }
     };
  global.document = {
    readyState: "complete",
    getElementById: byId,
    querySelectorAll(sel) { if (sel && sel.indexOf("data-diff") !== -1) return segBtns; return []; },
    createElement() { return makeCanvas(); },
    addEventListener() {}
     };
  global.requestAnimationFrame = function (cb) { rafCb = cb; return 1; };
  global.cancelAnimationFrame = function () {};
}

function flushFrames(n) { for (var i = 0; i < (n || 30); i++) if (rafCb) rafCb(); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 啟動真實 app.js，走 3D 分支
installDomFor3D();
require("../app.js");
const API = global.window.GomokuApp;
const els = global.document;
const gl = els.getElementById("gl");
const status = els.getElementById("s-status");

test("3D 路徑：檢視啟用 gl、隱藏 fallback", () => {
  assert.equal(gl.style.display, "block");
  assert.equal(els.getElementById("fallback").style.display, "none");
});

test("3D 路徑：經滑鼠 pointerdown/up 拾取落子，AI 回應", async () => {
  gl.dispatch("pointerdown", { clientX: 400, clientY: 400, buttons: 1 });
  gl.dispatch("pointerup", { clientX: 400, clientY: 400, buttons: 0 });
  var stones = API.game.stoneCount();
  assert.ok(stones >= 1, "黑棋已落子");
  await sleep(320);
  flushFrames(40);          // 執行落子動畫
  assert.ok(API.game.stoneCount() >= 2, "AI 已回應");
});

test("3D 路徑：勝局高亮與動畫", async () => {
  API.newGame();
  var g = API.game; g.vsAI = false;
  g.place(5, 7, G.BLACK); g.place(6, 7, G.BLACK); g.place(7, 7, G.BLACK);
  g.place(8, 7, G.BLACK); g.place(9, 7, G.BLACK);
  assert.equal(g.winner, G.BLACK);
  API.finish();
  assert.equal(status.textContent, "黑棋勝");
  flushFrames(40);          // 執行勝局高亮動畫 (pulsing rings)
  assert.ok(API.game.isOver());
});

test("3D 滾輪縮放：同步百分比、滑桿與無障礙文字", () => {
  var range = els.getElementById("zoom-range");
  var value = els.getElementById("zoom-value");
  range.value = "100";
  range.dispatch("input");

  gl.dispatch("wheel", { deltaX: 0, deltaY: -120, preventDefault() {} });

  assert.equal(value.textContent, "110%", "向上滾輪後百分比必須依原縮放速度更新");
  assert.equal(value.textContent, range.value + "%", "百分比必須與滑桿值一致");
  assert.equal(range.getAttribute("aria-valuetext"), value.textContent, "無障礙文字必須同步");

  range.value = "100";
  range.dispatch("input");
});


// 3D 路徑：拖曳 / 離場 / 縮放 / 難度 / 黑白和 狀態分支
test("3D 路徑：事件、難度、勝負狀態", async () => {
  var API = global.window.GomokuApp;
  gl.dispatch("pointerdown", { clientX: 400, clientY: 300, buttons: 1 });
  gl.dispatch("pointermove", { clientX: 440, clientY: 340, buttons: 1 });
  gl.dispatch("pointerup", { clientX: 440, clientY: 340, buttons: 0 });
  gl.dispatch("pointermove", { clientX: 400, clientY: 400, buttons: 0 });
  gl.dispatch("pointerleave", {});
  gl.dispatch("wheel", { deltaX: 0, deltaY: 120, preventDefault() {} });

  var seg = global.document.querySelectorAll(".seg [data-diff]");
  assert.equal(seg.length, 3);
  seg[0].dispatch("click");
  seg[1].dispatch("click");
  assert.equal(API.game.difficulty, "medium");

  API.newGame();
  var g = API.game;
  g.vsAI = false;
  for (var i = 3; i < 8; i++) g.place(i, 7, G.WHITE);
  assert.equal(g.winner, G.WHITE);
  API.finish();
  assert.equal(status.textContent, "白棋勝");

  g.winner = "draw"; g.winLine = null;
  API.refresh();
  assert.equal(status.textContent, "和棋");

  API.newGame();
  seg[2].dispatch("click");
  API.place(7, 7, G.BLACK);
  assert.ok(API.game.stoneCount() >= 1);
  await sleep(320);
  flushFrames(40);
  assert.ok(API.game.stoneCount() >= 2, "AI 回應");
});

// API.undo 在空棋譜上的早返回分支
test("API.undo：空棋譜不報錯", () => {
  var API = global.window.GomokuApp;
  API.newGame();
  API.undo();          // moves 為空 → 早返回
  assert.equal(API.game.stoneCount(), 0);
});
