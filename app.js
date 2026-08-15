/* =====================================================================
 * 五子棋 — 畫面控制與渲染 (app.js)
 * 使用 game.js 的純邏輯；3D 由 three.js 繪製，若 three.js 無法載入則
 * 自動改用 2D Canvas 渲染，確保遊戲始終可玩。
 * ===================================================================== */
(function () {
     "use strict";
     var G = window.Game;
     if (!G) { console.error("[五子棋] game.js 尚未載入"); return; }

   var SIZE = 15;
    var difficulty = "hard";   // easy | medium | hard
    var vsAI = true;
    var game = G.createGame({ size: SIZE, vsAI: vsAI, aiPlayer: G.WHITE, difficulty: difficulty });

    var locked = false;        // AI 思考中鎖定人類點擊
    var undoUsed = 0;          // 本局已使用的撤銷次數（新局歸零）
    var view = null;

  // 撤銷限制：簡單無限制、中等最多 1 次、困難禁用
  function undoLimit() { return difficulty === "easy" ? Infinity : difficulty === "medium" ? 1 : 0; }

     /* ---------------- DOM 引用 ---------------- */
  function $(id) { return document.getElementById(id); }
   var els = {
     gl: $("gl"), fb: $("fallback"),
     turn: $("turn"), turnDot: $("turn-dot"), turnLabel: $("turn-label"),
     sRound: $("s-round"), sStones: $("s-stones"), sBlack: $("s-black"), sWhite: $("s-white"),
     sWinrate: $("s-winrate"), sStreak: $("s-streak"), sStatus: $("s-status"), sMode: $("s-mode"),
     hint: $("hint"),
     toast: $("toast"),
     overlay: $("overlay"), ovEmoji: $("ov-emoji"), ovTitle: $("ov-title"), ovSub: $("ov-sub"),
     overlayNew: $("ov-new"), modeLabel: $("mode-label"),
     dock: $("dock"), dockClose: $("dock-close"), dockOpen: $("dock-open")
     };

     /* ---------------- 對戰統計（localStorage 持久化） ---------------- */
  var STATS_KEY = "gomoku-stats-v1";
  function loadStats() {
      try {
        var raw = localStorage.getItem(STATS_KEY);
        if (raw) {
          var s = JSON.parse(raw);
          if (typeof s.wins === "number" && typeof s.losses === "number" && typeof s.draws === "number") {
            s.streak = s.streak || 0; s.best = s.best || 0;
            return s;
          }
        }
      } catch (e) { /* 忽略損壞的資料 */ }
      return { wins: 0, losses: 0, draws: 0, streak: 0, best: 0 };
    }
  function saveStats() {
      try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* 忽略 */ }
    }
  var stats = loadStats();
  var statsSnapshot = null;   // 本局結果記錄前的快照（悔棋時還原）

  function recordResult(w) {
      statsSnapshot = { wins: stats.wins, losses: stats.losses, draws: stats.draws, streak: stats.streak, best: stats.best };
      if (w === G.BLACK) { stats.wins++; stats.streak++; }
      else if (w === G.WHITE) { stats.losses++; stats.streak = 0; }
      else { stats.draws++; stats.streak = 0; }
      if (stats.streak > stats.best) stats.best = stats.streak;
      saveStats();
    }
  function revertResult() {
      if (!statsSnapshot) return;
      stats = statsSnapshot; statsSnapshot = null;
      saveStats();
    }

     /* ---------------- 座標系統 (3D 與 2D 共用) ---------------- */
  var HALF = (SIZE - 1) / 2;
    var BORDER = 0.7;                    // 棋盤外框留白
  var BOARD_HALF = HALF + BORDER;
  var STONE_R = 0.42, STONE_H = 0.28;

  function star() { return [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]; } // 星位

     /* =========================================================
     *  3D 檢視 (three.js)
     * ========================================================= */
  function make3DView() {
      var THREE = window.THREE;
      var canvas = els.gl;

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);

        // 燈光
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      var fill = new THREE.DirectionalLight(0xbfd4ff, 0.35); fill.position.set(-6, 4, -4); scene.add(fill);
      var dir = new THREE.DirectionalLight(0xffffff, 1.15);
      dir.position.set(6, 13, 5);
      dir.castShadow = true;
      dir.shadow.mapSize.set(2048, 2048);
      dir.shadow.camera.left = -12; dir.shadow.camera.right = 12;
      dir.shadow.camera.top = 12; dir.shadow.camera.bottom = -12;
      dir.shadow.camera.near = 1; dir.shadow.camera.far = 45;
      dir.shadow.bias = -0.0004;
      scene.add(dir);

        // 棋盤
      var group = new THREE.Group();
      scene.add(group);

      var slab = new THREE.Mesh(
        new THREE.BoxGeometry(BOARD_HALF * 2, 1, BOARD_HALF * 2),
        new THREE.MeshStandardMaterial({ color: 0x2c1e12, roughness: 0.9, metalness: 0.02 })
         );
      slab.position.y = -0.5; slab.receiveShadow = true;
      group.add(slab);

      var top = new THREE.Mesh(
        new THREE.PlaneGeometry(BOARD_HALF * 2, BOARD_HALF * 2),
        new THREE.MeshStandardMaterial({ map: makeBoardTexture(), roughness: 0.55, metalness: 0.03 })
         );
      top.rotation.x = -Math.PI / 2; top.position.y = 0.001; top.receiveShadow = true;
      group.add(top);

      var stones = new THREE.Group(); group.add(stones);
      var marks = new THREE.Group(); group.add(marks);     // 勝局高亮

        // 最後一手標記（紅環）
      var lastMarker = new THREE.Mesh(
        new THREE.TorusGeometry(STONE_R * 0.5, 0.05, 12, 32),
        new THREE.MeshStandardMaterial({ color: 0xff5a4d, emissive: 0xff2d1f, emissiveIntensity: 0.7, roughness: 0.3 })
         );
      lastMarker.rotation.x = -Math.PI / 2; lastMarker.position.y = STONE_H + 0.04;
      lastMarker.visible = false;
      group.add(lastMarker);

        // 懸停指示
      var hover = new THREE.Mesh(
        new THREE.RingGeometry(STONE_R * 0.9, STONE_R * 1.02, 40),
        new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
         );
      hover.rotation.x = -Math.PI / 2; hover.position.y = 0.02; hover.visible = false;
      group.add(hover);

      function wx(gx) { return gx - HALF; }
      function wz(gy) { return gy - HALF; }

        // 攝影機 orbit
      var orbit = { radius: 15, theta: 0.6, phi: 0.92, last: { x: 0, y: 0 } };
      function applyCam() {
        orbit.radius = Math.max(8, Math.min(30, orbit.radius));
        var sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
        camera.position.set(
          orbit.radius * sp * Math.sin(orbit.theta),
          orbit.radius * cp + 0.6,
          orbit.radius * sp * Math.cos(orbit.theta));
        camera.lookAt(0, 0.2, 0);
         }

      var blackMat = new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.3, metalness: 0.25 });
      var whiteMat = new THREE.MeshStandardMaterial({ color: 0xf3efe2, roughness: 0.42, metalness: 0.06 });
      var stoneGeo = new THREE.CylinderGeometry(STONE_R, STONE_R * 0.92, STONE_H, 48);

      var animators = [];
      function addStone(gx, gy, player, instant) {
        var m = new THREE.Mesh(stoneGeo, player === G.BLACK ? blackMat : whiteMat);
        m.position.set(wx(gx), STONE_H / 2 + 0.011, wz(gy));
        m.castShadow = true; m.receiveShadow = true;
        stones.add(m);
        if (instant) return m;
        m.position.y = 6;
        m.userData = { startY: 6, targetY: STONE_H / 2 + 0.011, t0: null, done: false };
        animators.push(m);
        return m;
         }
      function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }
      function clearWinRings() { clearGroup(marks); }

      function addWinRing(gx, gy, color) {
        var mat = new THREE.MeshStandardMaterial({
          color: color, emissive: color, emissiveIntensity: 0.85, roughness: 0.3, metalness: 0.3 });
        var ring = new THREE.Mesh(new THREE.TorusGeometry(STONE_R * 1.18, 0.055, 14, 44), mat);
        ring.position.set(wx(gx), STONE_H + 0.05, wz(gy));
        ring.rotation.x = -Math.PI / 2;
        marks.add(ring);
         }
      function setLast(gx, gy) {
        lastMarker.position.set(wx(gx), STONE_H + 0.035, wz(gy));
        lastMarker.visible = true;
         }

        // 拾取與 orbit 事件
      var pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      var ray = new THREE.Raycaster();
      var ndc = new THREE.Vector2();
      var onPickCb = null, onHoverCb = null;
      var downX = 0, downY = 0, dragging = false, moved = false;

      function gridFromEvent(e) {
        var r = canvas.getBoundingClientRect();
        ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
        ray.setFromCamera(ndc, camera);
        var pt = new THREE.Vector3();
        if (!ray.ray.intersectPlane(pickPlane, pt)) return null;
        var gx = Math.round(pt.x + HALF), gy = Math.round(pt.z + HALF);
        if (gx < 0 || gy < 0 || gx >= SIZE || gy >= SIZE) return null;
        return { x: gx, y: gy };
         }

      canvas.addEventListener("pointerdown", function (e) {
        if (locked) return;
        dragging = true; moved = false;
        downX = e.clientX; downY = e.clientY;
        orbit.last = { x: e.clientX, y: e.clientY };
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
         });
      canvas.addEventListener("pointermove", function (e) {
        if (dragging && e.buttons) {
          var dx = e.clientX - orbit.last.x, dy = e.clientY - orbit.last.y;
          orbit.last = { x: e.clientX, y: e.clientY };
          if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 5) moved = true;
          orbit.theta -= dx * 0.006;
          orbit.phi = Math.max(0.32, Math.min(1.35, orbit.phi - dy * 0.006));
         } else if (!locked) {
          var g = gridFromEvent(e);
          if (g) { hover.visible = true; hover.position.set(wx(g.x), 0.02, wz(g.y)); if (onHoverCb) onHoverCb(g); }
          else hover.visible = false;
           }
         });
      canvas.addEventListener("pointerup", function (e) {
        if (dragging && !moved && !locked) {
          var g = gridFromEvent(e);
          if (g && onPickCb) onPickCb(g);
           }
        dragging = false;
         });
      canvas.addEventListener("pointerleave", function () { hover.visible = false; if (onHoverCb) onHoverCb(null); });
      canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        orbit.radius = Math.max(8, Math.min(30, orbit.radius + e.deltaY * 0.012));
         }, { passive: false });

      var clock = 0;
      function frame() {
        clock += 0.016;
        for (var i = animators.length - 1; i >= 0; i--) {
          var m = animators[i], ud = m.userData;
          if (ud.t0 === null) ud.t0 = clock;
          var p = Math.min(1, (clock - ud.t0) / 0.32);
          var eased = 1 - Math.pow(1 - p, 3);
          m.position.y = ud.startY + (ud.targetY - ud.startY) * eased;
          if (p >= 1) { m.userData.done = true; animators.splice(i, 1); }
           }
        var pulse = 0.65 + Math.sin(clock * 4) * 0.35;
        for (var k = 0; k < marks.children.length; k++) marks.children[k].material.emissiveIntensity = pulse;
        applyCam();
        renderer.render(scene, camera);
        requestAnimationFrame(frame);
         }

      function resize() {
        var w = window.innerWidth, h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
         }
      resize();
      requestAnimationFrame(frame);

      return {
        _3d: true,
        place: function (gx, gy, player, instant) { addStone(gx, gy, player, instant); },
        markLast: function (gx, gy) { setLast(gx, gy); },
        markWin: function (cells, color) { clearWinRings(); color = color || 0xffcf5a; cells.forEach(function (c) { addWinRing(c[0], c[1], color); }); },
        clearMarks: function () { clearWinRings(); lastMarker.visible = false; },
        reset: function () { clearGroup(stones); clearGroup(marks); lastMarker.visible = false; animators.length = 0; },
        onPick: function (cb) { onPickCb = cb; },
        onHover: function (cb) { onHoverCb = cb; },
        resize: resize
         };
    }

    function makeBoardTexture() {
      var size = 1024;
      var cv = document.createElement("canvas");
      cv.width = cv.height = size;
      var c = cv.getContext("2d");
      var N = SIZE, margin = size * 0.06;
      var cell = (size - margin * 2) / (N - 1);
        // 木紋底色
      var g = c.createLinearGradient(0, 0, size, size);
      g.addColorStop(0, "#e8b46a"); g.addColorStop(0.5, "#d89b4f"); g.addColorStop(1, "#c98a3d");
      c.fillStyle = g; c.fillRect(0, 0, size, size);
        // 棋線
      c.strokeStyle = "rgba(40,24,10,0.85)"; c.lineWidth = Math.max(1.2, size * 0.0013);
      for (var i = 0; i < N; i++) {
        var p = margin + i * cell;
        c.beginPath(); c.moveTo(margin, p); c.lineTo(size - margin, p); c.stroke();
        c.beginPath(); c.moveTo(p, margin); c.lineTo(p, size - margin); c.stroke();
         }
        // 星位
      c.fillStyle = "rgba(30,16,6,0.95)";
      star().forEach(function (s) {
        c.beginPath();
        c.arc(margin + s[0] * cell, margin + s[1] * cell, size * 0.006, 0, Math.PI * 2);
        c.fill();
         });
      var tex = new window.THREE.CanvasTexture(cv);
      tex.anisotropy = 4;
      return tex;
       }

     /* =========================================================
     *  2D 備援檢視
     * ========================================================= */
  function make2DView() {
      var canvas = els.fb;
      var ctx = canvas.getContext("2d");
      var st = { stones: {}, last: null, win: [], winColor: 0xffcf5a };
      var cell, px, py;

      function layout() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = window.innerWidth, h = window.innerHeight;
        canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
        canvas.style.width = w + "px"; canvas.style.height = h + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cell = Math.min((w - 90) / (SIZE - 1), (h - 90) / (SIZE - 1));
        px = (w - cell * (SIZE - 1)) / 2;
        py = (h - cell * (SIZE - 1)) / 2;
         }
      function X(gx) { return px + gx * cell; }
      function Y(gy) { return py + gy * cell; }

      function draw() {
        layout();
        var w = window.innerWidth, h = window.innerHeight;
        ctx.clearRect(0, 0, w, h);
        var x0 = px - cell * 0.6, y0 = py - cell * 0.6;
        var bw = cell * (SIZE - 1) + cell * 1.2;
          // 底盤
        ctx.fillStyle = "#3a2a1a"; roundRect(ctx, x0 - 8, y0 - 8, bw + 16, bw + 16, 16); ctx.fill();
        var grd = ctx.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, "#e8b46a"); grd.addColorStop(1, "#c98a3d");
        ctx.fillStyle = grd; roundRect(ctx, x0, y0, bw, bw, 10); ctx.fill();
          // 棋線
        ctx.strokeStyle = "rgba(40,24,10,0.85)"; ctx.lineWidth = 1.3;
        for (var i = 0; i < SIZE; i++) {
          ctx.beginPath(); ctx.moveTo(X(i), Y(0)); ctx.lineTo(X(i), Y(SIZE - 1)); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(X(0), Y(i)); ctx.lineTo(X(SIZE - 1), Y(i)); ctx.stroke();
           }
        ctx.fillStyle = "rgba(30,16,6,0.95)";
        star().forEach(function (s) { ctx.beginPath(); ctx.arc(X(s[0]), Y(s[1]), 3, 0, 7); ctx.fill(); });
          // 勝局高亮
        st.win.forEach(function (c2) {
          ctx.strokeStyle = "#" + st.winColor.toString(16).padStart(6, "0"); ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(X(c2[0]), Y(c2[1]), cell * 0.42, 0, 7); ctx.stroke();
           });
          // 棋子
        Object.keys(st.stones).forEach(function (key) {
          var s = st.stones[key]; drawStone(s.x, s.y, s.player);
           });
          // 最後一手
        if (st.last) {
          ctx.strokeStyle = "#ff5a4d"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(X(st.last.x), Y(st.last.y), cell * 0.16, 0, 7); ctx.stroke();
           }
         }
      function drawStone(gx, gy, player) {
        var r = cell * 0.42, cx = X(gx), cy = Y(gy);
        var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r);
        if (player === G.BLACK) { g.addColorStop(0, "#5a6072"); g.addColorStop(0.5, "#20232b"); g.addColorStop(1, "#0c0d12"); }
        else { g.addColorStop(0, "#ffffff"); g.addColorStop(0.6, "#eee7d5"); g.addColorStop(1, "#c9c2b0"); }
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
        if (player === G.WHITE) { ctx.strokeStyle = "rgba(120,110,90,0.45)"; ctx.lineWidth = 1; ctx.stroke(); }
         }
      function roundRect(c2, x, y, w, h, r) {
        c2.beginPath();
        c2.moveTo(x + r, y);
        c2.arcTo(x + w, y, x + w, y + h, r);
        c2.arcTo(x + w, y + h, x, y + h, r);
        c2.arcTo(x, y + h, x, y, r);
        c2.arcTo(x, y, x + w, y, r);
        c2.closePath();
         }
      function fromEvent(e) {
        var r = canvas.getBoundingClientRect();
        var gx = Math.round((e.clientX - r.left - px) / cell);
        var gy = Math.round((e.clientY - r.top - py) / cell);
        if (gx < 0 || gy < 0 || gx >= SIZE || gy >= SIZE) return null;
        return { x: gx, y: gy };
         }
      var onPickCb = null;
      canvas.addEventListener("pointerdown", function (e) {
        if (locked) return;
        var g = fromEvent(e);
        if (g && onPickCb) onPickCb(g);
         });
      function resize() { draw(); }
      resize();
      return {
        _2d: true,
        place: function (gx, gy, player, instant) { st.stones[gx + "," + gy] = { x: gx, y: gy, player: player }; draw(); },
        markLast: function (gx, gy) { st.last = { x: gx, y: gy }; draw(); },
        markWin: function (cells, color) { st.win = cells; st.winColor = color || 0xffcf5a; draw(); },
        clearMarks: function () { st.win = []; st.last = null; draw(); },
        reset: function () { st.stones = {}; st.last = null; st.win = []; draw(); },
        onPick: function (cb) { onPickCb = cb; },
        onHover: function () { },
        resize: resize
         };
       }

     /* =========================================================
     *  控制器
     * ========================================================= */
  function buildView() {
      var use3D = typeof window.THREE !== "undefined";
      els.gl.style.display = use3D ? "block" : "none";
      els.fb.style.display = use3D ? "none" : "block";
      view = use3D ? make3DView() : make2DView();
      view.onPick(onPick);
      view.onHover(function (cell) {
        // 可顯示座標提示；回呼不影響邏輯
      });
      if (!use3D) els.hint.textContent = "已切換 2D 模式（無法載入 3D 引擎）· 點擊棋盤落子";
       }

  function forbiddenLabel(type) {
      return type === "overline" ? "長連" : type === "doubleFour" ? "四四" : type === "doubleThree" ? "三三" : "禁手";
       }

  function placeAt(pos) {
      if (game.isOver() || locked) return;
      var tp = game.currentPlayer();
      if (game.vsAI && tp !== game.humanPlayer) return;    // 輪到 AI
      var ok = game.place(pos.x, pos.y, tp);
      if (!ok) {
        // 黑棋禁手：首犯已由 place() 退回，提示後請玩家重新落子。
        if (game.forbiddenWarn) {
          showWarning("黑棋形成「" + forbiddenLabel(game.forbiddenWarn.type) + "」禁手，已退回此手。\n請重新落子 — 當局再次違規將直接判負。");
          game.forbiddenWarn = null;
          refresh();
          }
        return;
        }
      view.place(pos.x, pos.y, tp);
      view.markLast(pos.x, pos.y);
      refresh();
      if (game.isOver()) return finish();
      if (game.vsAI && game.currentPlayer() === game.aiPlayer) requestAI();
       }

  function requestAI() {
      locked = true; setBusy(true);
      setTimeout(function () {
        var m = game.aiMove();
        if (m) { view.place(m.x, m.y, m.player); view.markLast(m.x, m.y); refresh(); }
        locked = false; setBusy(false);
        if (game.isOver()) finish();
         }, 230);
       }

  function rewindAll() {
      view.reset();
      for (var i = 0; i < game.moves.length; i++) {
        var mv = game.moves[i];
        view.place(mv.x, mv.y, mv.player, true);
           }
      var last = game.moves[game.moves.length - 1];
      if (last) view.markLast(last.x, last.y);
      if (game.winLine) view.markWin(game.winLine);
         }


  function newGame() {
      game = G.createGame({ size: SIZE, vsAI: vsAI, aiPlayer: G.WHITE, difficulty: difficulty });
      undoUsed = 0;
      view.clearMarks();
      view.reset();
      hideOverlay();
      if (els.toast) els.toast.classList.remove("show");
      refresh();
       }

  function finish() {
      var w = game.winner;
      if (game.vsAI) recordResult(w);   // 僅對戰 AI 時記錄（人類持黑）
      var emoji = "🏆", title = "黑棋獲勝", sub = "五子連連", color = 0xffcf5a;
      if (w === G.WHITE) { title = "白棋獲勝"; emoji = "⚪"; }
      else if (w === "draw") { title = "和棋"; emoji = "🤝"; sub = "棋盤已滿"; }
      if (game.forbidden) {                       // 黑棋因禁手判負
        title = "黑棋禁手判負"; emoji = "🚫"; sub = "當局再次形成「" + forbiddenLabel(game.forbiddenType) + "」"; color = 0xff5a4d;
        }
      if (game.winLine) view.markWin(game.winLine, color);
      els.ovEmoji.textContent = emoji;
      els.ovTitle.textContent = title;
      els.ovSub.textContent = sub;
      refresh();
      setTimeout(function () { els.overlay.classList.add("show"); }, 350);
       }

  function hideOverlay() { els.overlay.classList.remove("show"); }

  var toastTimer = null;
  function showWarning(msg) {
      if (!els.toast) return;
      els.toast.textContent = msg;
      els.toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 3600);
       }

  function setBusy(b) {
      $("btn-new").disabled = b;
      $("btn-undo").disabled = b || game.moves.length === 0 || undoUsed >= undoLimit();
       }

  function refresh() {
      var tp = game.currentPlayer();
      if (game.isOver()) {
        els.turn.classList.remove("active");
        els.turnLabel.textContent = game.winner === "draw" ? "和棋" : "棋局結束";
        }
      else {
        els.turn.classList.add("active");
        els.turnDot.className = "dot " + (tp === G.BLACK ? "stone-black" : "stone-white");
        var t = tp === G.BLACK ? "輪到黑棋" : "輪到白棋";
        if (game.vsAI) t += tp === game.humanPlayer ? "（你）" : "（AI 思考中…）";
        els.turnLabel.textContent = t;
         }

      var bcnt = 0, wcnt = 0;
      for (var i = 0; i < game.moves.length; i++) game.moves[i].player === G.BLACK ? bcnt++ : wcnt++;
      els.sRound.textContent = game.round;
      els.sStones.textContent = (bcnt + wcnt) + " / " + (SIZE * SIZE);
      els.sBlack.textContent = bcnt;
      els.sWhite.textContent = wcnt;
      if (game.vsAI) {
        var decisive = stats.wins + stats.losses;
        els.sWinrate.textContent = decisive ? Math.round(stats.wins / decisive * 100) + "%" : "–";
        els.sStreak.textContent = stats.streak + (stats.best > stats.streak ? "（最佳 " + stats.best + "）" : "");
      } else {
        els.sWinrate.textContent = "–";
        els.sStreak.textContent = "–";
      }

      els.sStatus.textContent = "進行中";
      els.sStatus.className = "v";
      if (game.isOver()) {
        if (game.winner === G.BLACK) { els.sStatus.textContent = "黑棋勝"; els.sStatus.className = "v status-win"; }
        else if (game.winner === G.WHITE) { els.sStatus.textContent = "白棋勝"; els.sStatus.className = "v status-win"; }
        else { els.sStatus.textContent = "和棋"; els.sStatus.className = "v status-draw"; }
         }
      els.sMode.textContent = game.vsAI ? "對戰 AI（" + diffName() + "）" : "雙人類";
      $("btn-undo").disabled = locked || game.moves.length === 0 || undoUsed >= undoLimit();
       }

  function diffName() { return difficulty === "easy" ? "簡單" : difficulty === "medium" ? "中等" : "困難"; }

  function onPick(pos) { placeAt(pos); }

  function syncDock() {
      // 桌面版控制列永遠顯示；只在行動版允許收合
      if (window.innerWidth > 760) {
        els.dock.classList.remove("hidden");
        els.dockOpen.classList.remove("show");
      }
    }

  function wireUI() {
      document.querySelectorAll(".seg [data-diff]").forEach(function (b) {
        b.addEventListener("click", function () {
          difficulty = b.getAttribute("data-diff");
          game.difficulty = difficulty;
          document.querySelectorAll(".seg [data-diff]").forEach(function (x) {
            x.setAttribute("aria-pressed", x === b ? "true" : "false");
             });
          refresh();
           });
         });
       $("btn-new").addEventListener("click", newGame);
       els.overlayNew.addEventListener("click", newGame);
       $("btn-undo").addEventListener("click", function () {
        if (undoUsed >= undoLimit()) return;   // 已達本局撤銷上限
        var wasOver = game.isOver();
        if (!game.undo()) return;
        undoUsed++;
        if (wasOver) revertResult();   // 悔棋退回已記錄的結果
        hideOverlay();
        rewindAll();
        refresh();
        if (game.vsAI && !game.isOver() && game.currentPlayer() === game.aiPlayer) requestAI();
         });
       $("btn-mode").addEventListener("click", function () {
        vsAI = !vsAI;
        game.vsAI = vsAI;
        game.aiPlayer = vsAI ? G.WHITE : null;
        game.humanPlayer = vsAI ? G.BLACK : null;
        els.modeLabel.textContent = vsAI ? "對戰 AI" : "雙人類";
        refresh();
        if (vsAI && game.currentPlayer() === game.aiPlayer && !game.isOver()) requestAI();
         });
      window.addEventListener("resize", function () { if (view.resize) view.resize(); syncDock(); });

      // 行動版：收起／展開控制列
      els.dockClose.addEventListener("click", function () {
        els.dock.classList.add("hidden");
        els.dockOpen.classList.add("show");
      });
      els.dockOpen.addEventListener("click", function () {
        els.dock.classList.remove("hidden");
        els.dockOpen.classList.remove("show");
      });
       }

  function boot() {
      buildView();
      wireUI();
      refresh();
      // 此設定黑棋先手，AI 為白，無需自動先行。
      setTimeout(function () { els.hint.style.opacity = "0"; }, 6500);
       }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
        // 公開 API：方便除錯與測試（非 UI 必需）
    window.GomokuApp = {
      get game() { return game; },
      get stats() { return stats; },
      place: function (x, y) { placeAt({ x: x, y: y }); },
      finish: finish,
      refresh: refresh,
      newGame: newGame,
      undo: function () {
        if (undoUsed >= undoLimit()) return;
        if (!game.undo()) return;
        undoUsed++;
        hideOverlay();
        rewindAll();
        refresh();
      }
    };
    })();
