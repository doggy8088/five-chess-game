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
     var ZOOM_MIN = 30, ZOOM_MAX = 130, DEFAULT_ZOOM = 100;
     var SETTINGS_KEY = "gomoku-settings-v1";
     var BOARD_VIEW_PRESETS = [
       { name: "右前方", theta: 0.6, phi: 0.92 },
       { name: "正面（下方朝前）", theta: 0, phi: 0.92 },
       { name: "正面（上方朝前）", theta: Math.PI, phi: 0.92 },
       { name: "左前方", theta: -0.6, phi: 0.92 },
       { name: "左後方", theta: -2.54, phi: 0.92 },
       { name: "右後方", theta: 2.54, phi: 0.92 },
       { name: "俯視", theta: 0.6, phi: 0.32 }
     ];

  function normalizeDifficulty(value) {
      return value === "easy" || value === "medium" || value === "hard" ? value : "hard";
       }

  function normalizeZoom(value) {
      var zoom = Number(value);
      if (!isFinite(zoom)) zoom = DEFAULT_ZOOM;
      zoom = Math.round(zoom / 5) * 5;
      return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
       }

  function normalizePlayerSide(value) {
      return value === "white" ? "white" : "black";
       }

  function normalizeBoardView(value) {
      var hasTheta = value && value.theta != null && isFinite(Number(value.theta));
      var hasPhi = value && value.phi != null && isFinite(Number(value.phi));
      return {
        theta: hasTheta ? Number(value.theta) : BOARD_VIEW_PRESETS[0].theta,
        phi: hasPhi ? Math.max(0.32, Math.min(1.35, Number(value.phi))) : BOARD_VIEW_PRESETS[0].phi
      };
       }

  function normalizeBoardViewPreset(value) {
      var index = Number(value);
      return Number.isInteger(index) && index >= 0 && index < BOARD_VIEW_PRESETS.length ? index : 0;
       }

  function loadSettings() {
      try {
        var raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          return {
            difficulty: normalizeDifficulty(saved.difficulty),
            zoom: normalizeZoom(saved.zoom),
            playerSide: normalizePlayerSide(saved.playerSide),
            boardViewLocked: saved.boardViewLocked === true,
            boardView: normalizeBoardView(saved.boardView),
            boardViewPreset: normalizeBoardViewPreset(saved.boardViewPreset)
          };
        }
      } catch (e) { /* 忽略損壞或不可用的設定 */ }
      return {
        difficulty: "hard",
        zoom: DEFAULT_ZOOM,
        playerSide: "black",
        boardViewLocked: false,
        boardView: normalizeBoardView(null),
        boardViewPreset: 0
      };
       }

  var savedSettings = loadSettings();
    var difficulty = savedSettings.difficulty;   // easy | medium | hard
    var currentZoom = savedSettings.zoom;
    var playerSide = savedSettings.playerSide;   // black | white
    var boardViewLocked = savedSettings.boardViewLocked;
    var boardView = savedSettings.boardView;
    var boardViewPreset = savedSettings.boardViewPreset;
    var vsAI = true;
    var aiPlayer = vsAI ? (playerSide === "white" ? G.BLACK : G.WHITE) : null;
    var game = G.createGame({ size: SIZE, vsAI: vsAI, aiPlayer: aiPlayer, difficulty: difficulty });

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
     overlay: $("overlay"), overlayClose: $("ov-close"), ovEmoji: $("ov-emoji"), ovTitle: $("ov-title"), ovSub: $("ov-sub"),
     zoomRange: $("zoom-range"), zoomValue: $("zoom-value"),
     overlayNew: $("ov-new"), overlayShare: $("ov-share"), overlayDownload: $("ov-download"), modeLabel: $("mode-label"),
     dock: $("dock"), dockClose: $("dock-close"), dockOpen: $("dock-open"),
     boardViewLocal: $("btn-board-view-local"), boardViewOnline: $("btn-board-view-online"),
     boardLockLocal: $("btn-board-lock-local"), boardLockOnline: $("btn-board-lock-online"),
     gameMenu: $("local-game-menu"), gameMenuOpen: $("btn-game-menu"),
     gameMenuHome: $("menu-game-home"), gameMenuClose: $("menu-game-close")
     };

  function saveSettings() {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
          difficulty: difficulty,
          zoom: currentZoom,
          playerSide: playerSide,
          boardViewLocked: boardViewLocked,
          boardView: boardView,
          boardViewPreset: boardViewPreset
        }));
      } catch (e) { /* 忽略不可用的儲存空間 */ }
       }

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
      if (w === game.humanPlayer) { stats.wins++; stats.streak++; }
      else if (w === game.aiPlayer) { stats.losses++; stats.streak = 0; }
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
      var labels = new THREE.Group();
      labels.visible = false;
      group.add(labels);   // 落子順序編號
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
      var reportedZoom = DEFAULT_ZOOM, onZoomCb = null, onViewChangeCb = null;
      var viewTransition = null;
      function applyCam() {
        orbit.radius = Math.max(8, Math.min(60, orbit.radius));
        var sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
        camera.position.set(
          orbit.radius * sp * Math.sin(orbit.theta),
          orbit.radius * cp + 0.6,
          orbit.radius * sp * Math.cos(orbit.theta));
        camera.lookAt(0, 0.2, 0);
         }
      function setZoom(percent) {
        var zoom = normalizeZoom(percent);
        reportedZoom = zoom;
        orbit.radius = 15 * DEFAULT_ZOOM / zoom;
         }
      function setView(nextView) {
        var normalized = normalizeBoardView(nextView);
        viewTransition = null;
        orbit.theta = normalized.theta;
        orbit.phi = normalized.phi;
         }
      function animateView(nextView) {
        var normalized = normalizeBoardView(nextView);
        var thetaDelta = Math.atan2(
          Math.sin(normalized.theta - orbit.theta),
          Math.cos(normalized.theta - orbit.theta));
        viewTransition = {
          startTheta: orbit.theta,
          startPhi: orbit.phi,
          targetTheta: orbit.theta + thetaDelta,
          targetPhi: normalized.phi,
          startedAt: clock,
          duration: 0.48
        };
         }
      function reportViewChange() {
        if (onViewChangeCb) onViewChangeCb({ theta: orbit.theta, phi: orbit.phi });
         }

      var blackMat = new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.3, metalness: 0.25 });
      var whiteMat = new THREE.MeshStandardMaterial({ color: 0xf3efe2, roughness: 0.42, metalness: 0.06 });
      var stoneGeo = new THREE.CylinderGeometry(STONE_R, STONE_R * 0.92, STONE_H, 48);
      var labelGeo = new THREE.PlaneGeometry(STONE_R * 1.28, STONE_R * 1.28);

      function makeStoneNumberTexture(moveNumber, player) {
        var cv = document.createElement("canvas");
        cv.width = cv.height = 128;
        var c = cv.getContext("2d");
        var size = moveNumber >= 100 ? 44 : moveNumber >= 10 ? 58 : 72;
        c.clearRect(0, 0, 128, 128);
        c.font = "800 " + size + "px Arial, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        if (player === G.BLACK) {
          c.lineWidth = 7;
          c.strokeStyle = "rgba(0,0,0,0.72)";
          c.strokeText(String(moveNumber), 64, 66);
        }
        c.fillStyle = player === G.BLACK ? "#f5f7ff" : "#182033";
        c.fillText(String(moveNumber), 64, 66);
        return new THREE.CanvasTexture(cv);
         }

      var animators = [];
      function addStone(gx, gy, player, moveNumber, instant) {
        if (moveNumber == null) moveNumber = stones.children.length + 1;
        var m = new THREE.Mesh(stoneGeo, player === G.BLACK ? blackMat : whiteMat);
        var targetY = STONE_H / 2 + 0.011;
        m.position.set(wx(gx), targetY, wz(gy));
        m.castShadow = true; m.receiveShadow = true;
        stones.add(m);

        var label = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
          map: makeStoneNumberTexture(moveNumber, player),
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide
        }));
        label.position.set(wx(gx), STONE_H + 0.07, wz(gy));
        label.rotation.x = -Math.PI / 2;
        label.renderOrder = 3;
        labels.add(label);
        if (instant) return m;

        m.position.y = 6;
        m.userData = { startY: 6, targetY: targetY, t0: null, done: false };
        label.position.y = 6;
        label.userData = { startY: 6, targetY: STONE_H + 0.07, t0: null, done: false };
        animators.push(m, label);
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
        if (viewTransition) {
          viewTransition = null;
          reportViewChange();
        }
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
          if (!boardViewLocked) {
            orbit.theta -= dx * 0.006;
            orbit.phi = Math.max(0.32, Math.min(1.35, orbit.phi - dy * 0.006));
          }
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
        else if (dragging && moved && !boardViewLocked) reportViewChange();
        dragging = false;
         });
      canvas.addEventListener("pointerleave", function () {
        if (dragging && moved && !boardViewLocked) reportViewChange();
        dragging = false;
        hover.visible = false;
        if (onHoverCb) onHoverCb(null);
      });
      canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        if (boardViewLocked) return;
        var minRadius = 15 * DEFAULT_ZOOM / ZOOM_MAX;
        var maxRadius = 15 * DEFAULT_ZOOM / ZOOM_MIN;
        orbit.radius = Math.max(minRadius, Math.min(maxRadius, orbit.radius + e.deltaY * 0.012));
        var zoom = normalizeZoom(15 * DEFAULT_ZOOM / orbit.radius);
        if (zoom !== reportedZoom && onZoomCb) onZoomCb(zoom);
         }, { passive: false });

      var clock = 0;
      function frame() {
        clock += 0.016;
        if (viewTransition) {
          var viewProgress = Math.min(1, (clock - viewTransition.startedAt) / viewTransition.duration);
          var viewEase = viewProgress < 0.5
            ? 4 * viewProgress * viewProgress * viewProgress
            : 1 - Math.pow(-2 * viewProgress + 2, 3) / 2;
          orbit.theta = viewTransition.startTheta
            + (viewTransition.targetTheta - viewTransition.startTheta) * viewEase;
          orbit.phi = viewTransition.startPhi
            + (viewTransition.targetPhi - viewTransition.startPhi) * viewEase;
          if (viewProgress >= 1) viewTransition = null;
        }
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
        place: function (gx, gy, player, moveNumber, instant) { addStone(gx, gy, player, moveNumber, instant); },
        markLast: function (gx, gy) { setLast(gx, gy); },
        markWin: function (cells, color) { clearWinRings(); color = color || 0xffcf5a; cells.forEach(function (c) { addWinRing(c[0], c[1], color); }); },
        clearMarks: function () { clearWinRings(); lastMarker.visible = false; },
        showMoveNumbers: function () { labels.visible = true; },
        hideMoveNumbers: function () { labels.visible = false; },
        setZoom: setZoom,
        onZoom: function (cb) { onZoomCb = cb; },
        setView: setView,
        animateView: animateView,
        getView: function () { return { theta: orbit.theta, phi: orbit.phi }; },
        onViewChange: function (cb) { onViewChangeCb = cb; },
        reset: function () { clearGroup(stones); clearGroup(labels); clearGroup(marks); labels.visible = false; lastMarker.visible = false; animators.length = 0; },
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
      var st = { stones: {}, last: null, win: [], winColor: 0xffcf5a, showNumbers: false, zoom: DEFAULT_ZOOM };
      var cell, px, py;

      function layout() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = window.innerWidth, h = window.innerHeight;
        canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
        canvas.style.width = w + "px"; canvas.style.height = h + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cell = Math.min((w - 90) / (SIZE - 1), (h - 90) / (SIZE - 1)) * st.zoom / DEFAULT_ZOOM;
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
          var s = st.stones[key]; drawStone(s.x, s.y, s.player, st.showNumbers ? s.moveNumber : null);
           });
          // 最後一手
        if (st.last) {
          ctx.strokeStyle = "#ff5a4d"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(X(st.last.x), Y(st.last.y), cell * 0.16, 0, 7); ctx.stroke();
           }
         }
      function drawStone(gx, gy, player, moveNumber) {
        var r = cell * 0.42, cx = X(gx), cy = Y(gy);
        var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.15, cx, cy, r);
        if (player === G.BLACK) { g.addColorStop(0, "#5a6072"); g.addColorStop(0.5, "#20232b"); g.addColorStop(1, "#0c0d12"); }
        else { g.addColorStop(0, "#ffffff"); g.addColorStop(0.6, "#eee7d5"); g.addColorStop(1, "#c9c2b0"); }
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
        if (player === G.WHITE) { ctx.strokeStyle = "rgba(120,110,90,0.45)"; ctx.lineWidth = 1; ctx.stroke(); }
        if (moveNumber != null) {
          var fontSize = Math.max(8, Math.round(cell * (moveNumber >= 100 ? 0.22 : moveNumber >= 10 ? 0.28 : 0.32)));
          ctx.font = "800 " + fontSize + "px Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          if (player === G.BLACK) {
            ctx.lineWidth = Math.max(1, cell * 0.035);
            ctx.strokeStyle = "rgba(0,0,0,0.72)";
            ctx.strokeText(String(moveNumber), cx, cy);
          }
          ctx.fillStyle = player === G.BLACK ? "#f5f7ff" : "#182033";
          ctx.fillText(String(moveNumber), cx, cy);
           }
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
        place: function (gx, gy, player, moveNumber, instant) { st.stones[gx + "," + gy] = { x: gx, y: gy, player: player, moveNumber: moveNumber }; draw(); },
        markLast: function (gx, gy) { st.last = { x: gx, y: gy }; draw(); },
        markWin: function (cells, color) { st.win = cells; st.winColor = color || 0xffcf5a; draw(); },
        clearMarks: function () { st.win = []; st.last = null; draw(); },
        showMoveNumbers: function () { st.showNumbers = true; draw(); },
        hideMoveNumbers: function () { st.showNumbers = false; draw(); },
        setZoom: function (percent) { st.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(percent) || DEFAULT_ZOOM)); draw(); },
        setView: function () {},
        animateView: function () {},
        getView: function () { return null; },
        onViewChange: function () {},
        reset: function () { st.stones = {}; st.last = null; st.win = []; st.showNumbers = false; draw(); },
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
      if (view.onZoom) view.onZoom(setZoom);
      if (view.onViewChange) view.onViewChange(function (nextView) {
        boardView = normalizeBoardView(nextView);
        saveSettings();
      });
      if (!use3D) {
        els.hint.textContent = "已切換 2D 模式（無法載入 3D 引擎）· 點擊棋盤落子";
        if (els.boardViewLocal) els.boardViewLocal.classList.add("hidden");
        if (els.boardViewOnline) els.boardViewOnline.classList.add("hidden");
      }
      setZoom(currentZoom);
      view.setView(boardView);
       }

  function forbiddenLabel(type) {
      return type === "overline" ? "長連" : type === "doubleFour" ? "四四" : type === "doubleThree" ? "三三" : "禁手";
       }

  function placeAt(pos) {
      if (onlineMode) {
        if (onlinePickHandler) onlinePickHandler(pos.x, pos.y);
        return;
        }
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
      view.place(pos.x, pos.y, tp, game.moves.length);
      view.markLast(pos.x, pos.y);
      refresh();
      if (game.isOver()) return finish();
      if (game.vsAI && game.currentPlayer() === game.aiPlayer) requestAI();
       }

  function requestAI() {
      locked = true; setBusy(true);
      setTimeout(function () {
        var m = game.aiMove();
        if (m) { view.place(m.x, m.y, m.player, game.moves.length); view.markLast(m.x, m.y); refresh(); }
        locked = false; setBusy(false);
        if (game.isOver()) finish();
         }, 230);
       }

  function rewindAll() {
      view.reset();
      for (var i = 0; i < game.moves.length; i++) {
        var mv = game.moves[i];
        view.place(mv.x, mv.y, mv.player, i + 1, true);
           }
      var last = game.moves[game.moves.length - 1];
      if (last) view.markLast(last.x, last.y);
      if (game.winLine) view.markWin(game.winLine);
         }

  function closeSettingsPanel() {
      els.dock.classList.add("hidden");
      els.dockOpen.classList.add("show");
       }


  function newGame() {
      if (onlineMode) return; // 線上模式由伺服器驅動，不重置本地棋局
      var ap = vsAI ? (playerSide === "white" ? G.BLACK : G.WHITE) : null;
      game = G.createGame({ size: SIZE, vsAI: vsAI, aiPlayer: ap, difficulty: difficulty });
      undoUsed = 0;
      view.clearMarks();
      view.reset();
      closeSettingsPanel();
      hideOverlay();
      if (els.toast) els.toast.classList.remove("show");
      refresh();
      if (vsAI && game.currentPlayer() === game.aiPlayer) {
        requestAI();
      }
       }

  function closeOverlay() {
      hideOverlay();
      if (view && view.showMoveNumbers) view.showMoveNumbers();
       }

  function showOverlay() {
      if (view && view.hideMoveNumbers) view.hideMoveNumbers();
      els.overlay.classList.add("show");
       }

  function reopenOverlay() {
      if (!game.isOver()) {
        var cur = game.currentPlayer();
        var emoji = cur === G.BLACK ? "⚫" : "⚪";
        var title = cur === G.BLACK ? "輪到黑棋" : "輪到白棋";
        if (game.vsAI) title += cur === game.humanPlayer ? "（你）" : "（AI）";
        var sub = "對奕進行中 · 目前已下 " + game.moves.length + " 手";
        els.ovEmoji.textContent = emoji;
        els.ovTitle.textContent = title;
        els.ovSub.textContent = sub;
      }
      showOverlay();
       }

  function shareCondition() {
      var mode = game.vsAI ? "對戰 AI · 難度：" + diffName() : "雙人對戰";
      var status = (els.ovTitle && els.ovTitle.textContent) ? els.ovTitle.textContent : (game.isOver() ? "棋局結束" : "對奕進行中");
      return mode + " · " + status + " · 15×15 棋盤 · " + game.moves.length + " 手";
       }

  function drawShareStone(c, x, y, radius, player, moveNumber) {
      var gradient = player === G.BLACK
        ? c.createRadialGradient(x - radius * 0.3, y - radius * 0.35, radius * 0.08, x, y, radius)
        : c.createRadialGradient(x - radius * 0.3, y - radius * 0.35, radius * 0.08, x, y, radius);
      if (player === G.BLACK) {
        gradient.addColorStop(0, "#5a6175");
        gradient.addColorStop(0.35, "#292d39");
        gradient.addColorStop(1, "#10121a");
      } else {
        gradient.addColorStop(0, "#ffffff");
        gradient.addColorStop(0.55, "#f3efe2");
        gradient.addColorStop(1, "#c9c1ae");
      }
      c.shadowColor = "rgba(0,0,0,0.38)";
      c.shadowBlur = Math.round(radius * 0.28);
      c.shadowOffsetY = Math.round(radius * 0.12);
      c.fillStyle = gradient;
      c.beginPath();
      c.arc(x, y, radius, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;
      c.strokeStyle = player === G.BLACK ? "rgba(255,255,255,0.16)" : "rgba(75,58,36,0.22)";
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = player === G.BLACK ? "#f4efe2" : "#1b1d24";
      c.font = "800 " + Math.round(radius * 0.9) + "px PingFang TC, Noto Sans TC, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(String(moveNumber), x, y + 1);
       }

  function makeShareCanvas() {
      var width = 1200;
      var headerHeight = 220;
      var boardSize = 1080;
      var footerHeight = 150;
      var boardX = (width - boardSize) / 2;
      var boardY = headerHeight;
      var canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = headerHeight + boardSize + footerHeight;
      var c = canvas.getContext("2d");
      var bg = c.createLinearGradient(0, 0, canvas.width, canvas.height);
      bg.addColorStop(0, "#0b1020");
      bg.addColorStop(0.58, "#141b31");
      bg.addColorStop(1, "#090d19");
      c.fillStyle = bg;
      c.fillRect(0, 0, canvas.width, canvas.height);
      var boardGradient = c.createLinearGradient(boardX, boardY, boardX + boardSize, boardY + boardSize);
      boardGradient.addColorStop(0, "#e0c99a");
      boardGradient.addColorStop(0.5, "#c4a878");
      boardGradient.addColorStop(1, "#a8865b");
      c.fillStyle = boardGradient;
      c.fillRect(boardX, boardY, boardSize, boardSize);
      c.strokeStyle = "rgba(64,43,23,0.55)";
      c.lineWidth = 5;
      c.strokeRect(boardX, boardY, boardSize, boardSize);

      var boardMargin = 82;
      var cell = (boardSize - boardMargin * 2) / (SIZE - 1);
      c.strokeStyle = "rgba(74,53,31,0.68)";
      c.lineWidth = 2;
      for (var line = 0; line < SIZE; line++) {
        var offset = boardMargin + line * cell;
        c.beginPath();
        c.moveTo(boardX + boardMargin, boardY + offset);
        c.lineTo(boardX + boardSize - boardMargin, boardY + offset);
        c.stroke();
        c.beginPath();
        c.moveTo(boardX + offset, boardY + boardMargin);
        c.lineTo(boardX + offset, boardY + boardSize - boardMargin);
        c.stroke();
      }
      c.fillStyle = "#5d4429";
      star().forEach(function (point) {
        c.beginPath();
        c.arc(boardX + boardMargin + point[0] * cell, boardY + boardMargin + point[1] * cell, 8, 0, Math.PI * 2);
        c.fill();
       });

      var shareRadius = cell * 0.39;
      game.moves.forEach(function (move, index) {
        drawShareStone(c, boardX + boardMargin + move.x * cell, boardY + boardMargin + move.y * cell, shareRadius, move.player, index + 1);
       });
      if (game.winLine && game.winLine.length) {
        c.strokeStyle = "#ffd166";
        c.lineWidth = 6;
        game.winLine.forEach(function (point) {
          c.beginPath();
          c.arc(boardX + boardMargin + point[0] * cell, boardY + boardMargin + point[1] * cell, shareRadius + 9, 0, Math.PI * 2);
          c.stroke();
         });
       }

      var pad = 60;
      c.fillStyle = "#eaf0ff";
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      c.font = "800 54px PingFang TC, Noto Sans TC, sans-serif";
      c.fillText("五子棋 · GOMOKU", pad, 78);
      c.fillStyle = "#9fb0d4";
      c.font = "600 30px PingFang TC, Noto Sans TC, sans-serif";
      c.fillText((game.vsAI ? "對戰 AI · 難度：" + diffName() : "雙人對戰") + " · " + (els.ovTitle.textContent || (game.isOver() ? "棋局結束" : "對奕進行中")), pad, 132);
      c.font = "600 28px PingFang TC, Noto Sans TC, sans-serif";
      c.fillText("15×15 完整棋盤 · " + game.moves.length + " 手", pad, 178);

      var footerTop = headerHeight + boardSize;
      c.fillStyle = "rgba(9, 13, 25, 0.92)";
      c.fillRect(0, footerTop, canvas.width, footerHeight);
      c.fillStyle = "#9fb0d4";
      c.font = "600 28px PingFang TC, Noto Sans TC, sans-serif";
      c.textAlign = "left";
      c.fillText(game.isOver() ? "完整 15×15 棋盤結果" : "完整 15×15 棋盤現況", pad, canvas.height - 54);
      var authorText = "Made with ❤️ by Will 保哥";
      var authorRight = canvas.width - pad;
      var authorWidth = c.measureText(authorText).width;
      c.fillText(authorText, Math.max(pad, authorRight - authorWidth), canvas.height - 54);
      return canvas;
       }

  function canvasToBlob(canvas) {
      return new Promise(function (resolve, reject) {
        try {
          var data = canvas.toDataURL("image/png");
          var binary = atob(data.split(",")[1]);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          resolve(new Blob([bytes], { type: "image/png" }));
        } catch (e) {
          if (!canvas.toBlob) { reject(e); return; }
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob); else reject(e);
             }, "image/png");
        }
         });
       }

  function padZero(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatDateTime(d) {
    var date = d instanceof Date ? d : new Date();
    var y = date.getFullYear();
    var m = padZero(date.getMonth() + 1);
    var day = padZero(date.getDate());
    var h = padZero(date.getHours());
    var min = padZero(date.getMinutes());
    var s = padZero(date.getSeconds());
    return y + m + day + "_" + h + min + s;
  }

  function getShareFilename(d) {
    var timeStr = formatDateTime(d);
    var modeStr = game.vsAI ? "對戰AI-" + diffName() : "雙人對戰";
    var resultStr = (els.ovTitle && els.ovTitle.textContent && els.ovTitle.textContent.trim()) ? els.ovTitle.textContent.trim() : (
      game.forbidden ? "黑棋禁手判負" :
      game.winner === G.BLACK ? "黑棋獲勝" :
      game.winner === G.WHITE ? "白棋獲勝" :
      game.winner === "draw" ? "和棋" :
      !game.isOver() ? "對奕進行中" : "棋局結束"
    );
    var movesStr = game.moves.length + "手";
    var safeResult = resultStr.replace(/[\\/:*?"<>|\s]/g, "");
    var safeMode = modeStr.replace(/[\\/:*?"<>|\s]/g, "");
    return "五子棋_" + timeStr + "_" + safeMode + "_" + safeResult + "_" + movesStr + ".png";
  }

  function downloadShareImage(blob, filename) {
      if (typeof URL === "undefined" || !URL.createObjectURL || !document.body) return false;
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = filename || getShareFilename();
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
       }

  function fallbackShare(blob, filename) {
      if (downloadShareImage(blob, filename)) showWarning("已下載棋局圖片，可從照片或檔案分享。");
      else showWarning("目前無法建立棋局圖片。");
       }

  function downloadResult() {
      if (!els.overlayDownload) return;
      els.overlayDownload.disabled = true;
      var filename = getShareFilename();
      Promise.resolve().then(function () { return canvasToBlob(makeShareCanvas()); }).then(function (blob) {
        if (downloadShareImage(blob, filename)) showWarning("已下載棋局圖片。");
        else showWarning("目前無法下載棋局圖片。");
         }).catch(function () { showWarning("目前無法建立棋局圖片。"); })
        .finally(function () { els.overlayDownload.disabled = false; });
       }

  function shareResult() {
      if (!els.overlayShare) return;
      els.overlayShare.disabled = true;
      var filename = getShareFilename();
      Promise.resolve().then(function () { return canvasToBlob(makeShareCanvas()); }).then(function (blob) {
        var nav = typeof navigator !== "undefined" ? navigator : null;
        var canUseFileShare = nav && typeof nav.share === "function" && typeof nav.canShare === "function" && typeof File !== "undefined";
        if (canUseFileShare) {
          try { canUseFileShare = nav.canShare({ files: [new File([blob], filename, { type: "image/png" })] }); }
          catch (e) { canUseFileShare = false; }
        }
        if (!canUseFileShare) {
          fallbackShare(blob, filename);
          return;
        }
        var file = new File([blob], filename, { type: "image/png" });
        return nav.share({ title: "五子棋對局結果", text: shareCondition(), files: [file] })
          .then(function () { showWarning("已開啟分享選單，可分享或儲存到照片。"); })
          .catch(function (err) {
            if (!err || err.name !== "AbortError") fallbackShare(blob, filename);
             });
         }).catch(function () { showWarning("目前無法建立棋局圖片。"); })
        .finally(function () { els.overlayShare.disabled = false; });
       }

  function finish() {
      var w = game.winner;
      if (view && view.hideMoveNumbers) view.hideMoveNumbers();
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
      setTimeout(showOverlay, 350);
       }

  function hideOverlay() {
      els.overlay.classList.remove("show");
       }

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
        els.turn.classList.add("result-prompt");
        els.turnLabel.textContent = game.winner === "draw" ? "和棋" : "棋局結束";
        }
      else {
        els.turn.classList.add("active");
        els.turn.classList.remove("result-prompt");
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

  function syncDifficultyButtons() {
      document.querySelectorAll(".seg [data-diff]").forEach(function (button) {
        button.setAttribute("aria-pressed", button.getAttribute("data-diff") === difficulty ? "true" : "false");
         });
       }

  function syncSideButtons() {
      document.querySelectorAll(".seg [data-side]").forEach(function (button) {
        button.setAttribute("aria-pressed", button.getAttribute("data-side") === playerSide ? "true" : "false");
         });
      var segSide = $("seg-side");
      if (segSide) {
        if (vsAI) segSide.classList.remove("disabled");
        else segSide.classList.add("disabled");
      }
       }

  function diffName() { return difficulty === "easy" ? "簡單" : difficulty === "medium" ? "中等" : "困難"; }

  function onPick(pos) { placeAt(pos); }

  function setZoom(percent) {
      var zoom = normalizeZoom(percent);
      currentZoom = zoom;
      els.zoomRange.value = String(zoom);
      els.zoomRange.setAttribute("aria-valuetext", zoom + "%");
      els.zoomValue.textContent = zoom + "%";
      if (view && view.setZoom) view.setZoom(zoom);
      saveSettings();
       }

  function syncDock() {
      // 響應式佈局調整時保留既有收合狀態
    }

  function syncBoardLockButtons() {
      var buttons = [els.boardLockLocal, els.boardLockOnline];
      for (var i = 0; i < buttons.length; i++) {
        if (!buttons[i]) continue;
        buttons[i].setAttribute("aria-pressed", String(boardViewLocked));
        buttons[i].innerHTML = '<span class="board-lock-icon" aria-hidden="true">'
          + (boardViewLocked ? "🔒" : "🔓")
          + '</span><span class="board-lock-label">'
          + (boardViewLocked ? "解除棋盤視角鎖定" : "鎖定棋盤視角")
          + "</span>";
        buttons[i].title = boardViewLocked ? "解除棋盤視角鎖定" : "鎖定棋盤視角";
        buttons[i].setAttribute("aria-label", buttons[i].title);
      }
      els.zoomRange.disabled = boardViewLocked;
    }

  function toggleBoardViewLock() {
      boardViewLocked = !boardViewLocked;
      syncBoardLockButtons();
      saveSettings();
      if (els.toast) {
        els.toast.textContent = boardViewLocked ? "棋盤視角已鎖定" : "棋盤視角已解除鎖定";
        els.toast.classList.add("show");
        setTimeout(function () { els.toast.classList.remove("show"); }, 1600);
      }
    }

  function cycleBoardView() {
      if (!view || !view._3d) return;
      boardViewPreset = (boardViewPreset + 1) % BOARD_VIEW_PRESETS.length;
      boardView = normalizeBoardView(BOARD_VIEW_PRESETS[boardViewPreset]);
      view.animateView(boardView);
      saveSettings();
      if (els.toast) {
        els.toast.textContent = "棋盤視角：" + BOARD_VIEW_PRESETS[boardViewPreset].name;
        els.toast.classList.add("show");
        setTimeout(function () { els.toast.classList.remove("show"); }, 1600);
      }
    }

  function wireUI() {
      document.querySelectorAll(".seg [data-diff]").forEach(function (b) {
        b.addEventListener("click", function () {
          difficulty = b.getAttribute("data-diff");
          game.difficulty = difficulty;
          syncDifficultyButtons();
          saveSettings();
          refresh();
           });
         });
      document.querySelectorAll(".seg [data-side]").forEach(function (b) {
        b.addEventListener("click", function () {
          var side = b.getAttribute("data-side");
          if (side === playerSide) return;
          playerSide = side;
          syncSideButtons();
          saveSettings();
          newGame();
           });
         });
       $("btn-new").addEventListener("click", newGame);
       els.overlayNew.addEventListener("click", newGame);
       els.overlayClose.addEventListener("click", closeOverlay);
       els.overlayShare.addEventListener("click", shareResult);
       els.overlayDownload.addEventListener("click", downloadResult);
       els.turn.addEventListener("click", reopenOverlay);
       els.zoomRange.addEventListener("input", function () { setZoom(els.zoomRange.value); });
       if (els.boardViewLocal) els.boardViewLocal.addEventListener("click", cycleBoardView);
       if (els.boardViewOnline) els.boardViewOnline.addEventListener("click", cycleBoardView);
       if (els.boardLockLocal) els.boardLockLocal.addEventListener("click", toggleBoardViewLock);
       if (els.boardLockOnline) els.boardLockOnline.addEventListener("click", toggleBoardViewLock);
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
        game.humanPlayer = vsAI ? (playerSide === "white" ? G.WHITE : G.BLACK) : null;
        game.aiPlayer = vsAI ? (playerSide === "white" ? G.BLACK : G.WHITE) : null;
        els.modeLabel.textContent = vsAI ? "對戰 AI" : "雙人類";
        syncSideButtons();
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
      syncBoardLockButtons();
       }

  function boot() {
      buildView();
      wireUI();
      syncDifficultyButtons();
      syncSideButtons();
      refresh();
      if (vsAI && game.currentPlayer() === game.aiPlayer) {
        requestAI();
      }
      setTimeout(function () { els.hint.style.opacity = "0"; }, 6500);
      initEntryScreen();
       }

  /* ==================== 遊戲入口首頁 ====================
   * 初始顯示入口（HTML 預設可見）；/r/:roomId 路徑則直接跳過（由線上流程接管）。 */

  function entryEl() { return document.getElementById("screen-entry"); }

  function hideEntry() {
      var el = entryEl();
      if (el) el.classList.add("hidden");
      if (document.body) document.body.classList.remove("entry-open");
       }

  function showEntry() {
      var el = entryEl();
      if (el) el.classList.remove("hidden");
      if (document.body) document.body.classList.add("entry-open");
       }

  // 對外開放入口首頁顯示／收起（online/ui.js 的「回主畫面」用）
  window.GomokuEntry = { show: showEntry, hide: hideEntry };

  // 遊戲中回主畫面：曾由「開始遊戲」push 過 /game 就走 history.back()（畫面交給 popstate 對齊）；
  // 直接載入 /game（背後沒有本站歷史可退）則就地改回 / 並切換畫面
  function exitGameToHome() {
      var st = null;
      try { st = history.state; } catch (e) { st = null; }
      if (st && st.gomokuScreen === "game") {
        history.back();
        return;
        }
      try { history.replaceState(null, "", "/"); } catch (e) { /* 靜態託管等環境不支援時忽略 */ }
      showEntry();
       }

  function closeGameMenu() {
      if (els.gameMenu) els.gameMenu.classList.add("hidden");
    }

  function requestExitGameToHome() {
      closeGameMenu();
      if (game.moves.length === 0) { exitGameToHome(); return; }
      var confirmApi = window.GomokuConfirm;
      if (confirmApi && typeof confirmApi.open === "function") {
        confirmApi.open("回遊戲主畫面", "確定要離開目前的對局嗎？遊戲進度會保留，回到主畫面後可再點「開始遊戲」續玩。", "離開遊戲", function () { exitGameToHome(); }, "繼續下棋");
      } else {
        exitGameToHome();
      }
    }

  function initEntryScreen() {
      var el = entryEl();
      if (!el) return;
      var path = "";
      try { path = (typeof location !== "undefined" && location.pathname) || ""; } catch (e) { path = ""; }
      if (/^\/r\//.test(path)) {
        // 邀請連結直入線上流程，跳過入口
        hideEntry();
        return;
        }
      if (path === "/game") {
        // /game 深連結／重新整理：直接進入本地遊戲畫面（URL 已正確，開頁不 pushState）。
        // 不 early-return：遊戲中的「主畫面」等按鈕仍需接線。
        hideEntry();
        }
      else if (document.body) document.body.classList.add("entry-open");
      var btn = document.getElementById("btn-entry-local");
      if (btn) btn.addEventListener("click", function () {
        // 讓瀏覽器上一頁能回入口首頁（畫面切換統一交給 popstate 對齊）
        try { history.pushState({ gomokuScreen: "game" }, "", "/game"); } catch (e) { /* 靜態託管等環境不支援時忽略 */ }
        hideEntry();
        });
      if (els.gameMenuOpen) els.gameMenuOpen.addEventListener("click", function () {
        if (els.gameMenu) els.gameMenu.classList.remove("hidden");
      });
      if (els.gameMenuClose) els.gameMenuClose.addEventListener("click", closeGameMenu);
      if (els.gameMenuHome) els.gameMenuHome.addEventListener("click", requestExitGameToHome);
       }

  /* ==================== 線上對戰整合（GomokuOnline API）====================
   * 線上模式：本地鏡像 game 只做渲染；權威狀態來自伺服器。
   * 點擊棋盤不直接落子，改呼叫 onlinePickHandler 由 OnlineSession 送出 action，
   * 等 server actionApplied 才套用渲染。 */

  var onlineMode = false;
  var onlinePickHandler = null;
  var onlineCtx = null;     // {mySeat, myColor, spectate, ruleset, blackSeat}
  var renderedMoves = 0;

  function refreshOnline() {
      var tp = game.currentPlayer();
      if (game.isOver()) {
        els.turn.classList.remove("active");
        els.turn.classList.add("result-prompt");
        els.turnLabel.textContent = game.winner === "draw" ? "和棋" : "棋局結束";
        }
      else {
        els.turn.classList.add("active");
        els.turn.classList.remove("result-prompt");
        els.turnDot.className = "dot " + (tp === G.BLACK ? "stone-black" : "stone-white");
        var t;
        if (onlineCtx && onlineCtx.spectate) t = (tp === G.BLACK ? "黑棋" : "白棋") + "落子中（觀戰）";
        else if (tp === onlineCtx.myColor) t = "輪到你落子";
        else t = "等待對手落子…";
        els.turnLabel.textContent = t;
        }

      var bcnt = 0, wcnt = 0;
      for (var i = 0; i < game.moves.length; i++) game.moves[i].player === G.BLACK ? bcnt++ : wcnt++;
      els.sRound.textContent = "–";
      els.sStones.textContent = (bcnt + wcnt) + " / " + (SIZE * SIZE);
      els.sBlack.textContent = bcnt;
      els.sWhite.textContent = wcnt;
      els.sWinrate.textContent = "–";
      els.sStreak.textContent = "–";
      els.sStatus.textContent = "進行中";
      els.sStatus.className = "v";
      if (game.isOver()) {
        if (game.winner === G.BLACK) { els.sStatus.textContent = "黑棋勝"; els.sStatus.className = "v status-win"; }
        else if (game.winner === G.WHITE) { els.sStatus.textContent = "白棋勝"; els.sStatus.className = "v status-win"; }
        else { els.sStatus.textContent = "和棋"; els.sStatus.className = "v status-draw"; }
        }
      var rulesetText = onlineCtx && onlineCtx.ruleset === "freestyle" ? "自由"
        : onlineCtx && onlineCtx.ruleset === "renju" ? "連珠" : "標準";
      els.sMode.textContent = onlineCtx && onlineCtx.spectate ? "線上觀戰（" + rulesetText + "）" : "線上對戰（" + rulesetText + "）";
      }

  function onlineRenderMove(mv, index, instant) {
      view.place(mv.x, mv.y, mv.player, index + 1, instant);
      }

  function onlineApplyState(dto) {
      if (!onlineMode) return;
      var moves = dto.moves || [];
      if (moves.length < renderedMoves) {
        // 狀態回退（new game 等）：完整重建
        view.reset();
        view.clearMarks();
        renderedMoves = 0;
        }
      // 鏡像本地 game：重放到最新
      game = G.createGame({ size: dto.size || SIZE, vsAI: false, ruleset: dto.ruleset || "standard" });
      for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        game.place(m.x, m.y, m.player);
        }
      // 對局結果（逾時/認輸/和棋等不反映在 moves 上）需從 DTO 還原
      if (dto.winner != null) {
        game.winner = dto.winner;
        game.turn = null;
        game.winLine = dto.winLine || null;
      }
      for (i = renderedMoves; i < moves.length; i++) onlineRenderMove(moves[i], i, renderedMoves === 0);
      renderedMoves = moves.length;
      var last = moves[moves.length - 1];
      if (last) view.markLast(last.x, last.y);
      if (game.winLine) view.markWin(game.winLine);
      refreshOnline();
      }

  window.GomokuOnline = {
      isActive: function () { return onlineMode; },
      get ctx() { return onlineCtx; },
      // 進入線上對戰畫面（重置盤面）
      enter: function (opts) {
        opts = opts || {};
        onlineMode = true;
        onlineCtx = {
          mySeat: opts.mySeat === 0 || opts.mySeat === 1 ? opts.mySeat : null,
          spectate: !!opts.spectate,
          blackSeat: opts.blackSeat || 0,
          ruleset: opts.ruleset || "standard"
        };
        onlineCtx.myColor = onlineCtx.mySeat === null ? null
          : (onlineCtx.mySeat === onlineCtx.blackSeat ? G.BLACK : G.WHITE);
        renderedMoves = 0;
        game = G.createGame({ size: SIZE, vsAI: false, ruleset: onlineCtx.ruleset });
        view.clearMarks();
        view.reset();
        hideOverlay();
        document.body.classList.add("mode-online");
        refreshOnline();
        },
      // 離開線上模式、還原本地遊戲
      leave: function () {
        onlineMode = false;
        onlinePickHandler = null;
        onlineCtx = null;
        renderedMoves = 0;
        document.body.classList.remove("mode-online");
        hideOverlay();
        newGame();
        },
      // 註冊線上落子 handler（返回 false 表示無法落子）
      onPick: function (handler) { onlinePickHandler = handler; },
      // 套用伺服器權威狀態（DTO）
      applyState: function (dto) { onlineApplyState(dto); },
      // 線上終局：用現有 overlay 顯示勝負
      showResult: function (info) {
        // info: {reasonText, winnerSeat, blackSeat, mySeat, moveNumber, canRematch}
        var emoji = "🏆", title = "對戰結束", sub = info.reasonText || "";
        if (info.winnerSeat === null || info.winnerSeat === undefined) {
          title = "和局"; emoji = "🤝";
          } else if (info.mySeat !== null && info.mySeat !== undefined && !info.spectate) {
          title = info.winnerSeat === info.mySeat ? "你獲勝了！" : "你輸了這局";
          emoji = info.winnerSeat === info.mySeat ? "🏆" : "💪";
          } else {
          title = info.winnerSeat === info.blackSeat ? "黑棋獲勝" : "白棋獲勝";
          emoji = info.winnerSeat === info.blackSeat ? "⚫" : "⚪";
          }
        sub = (sub ? sub + " · " : "") + "共 " + (info.moveNumber || 0) + " 手";
        els.ovEmoji.textContent = emoji;
        els.ovTitle.textContent = title;
        els.ovSub.textContent = sub;
        if (view && view.hideMoveNumbers) view.hideMoveNumbers();
        refreshOnline();
        setTimeout(showOverlay, 350);
        },
      hideResult: hideOverlay,
      refresh: function () { if (onlineMode) refreshOnline(); },
      // 標記鏡像對局為已結束（逾時/認輸/和棋等不反映在 moves 上的終局）
      markFinished: function (winnerColor, winLine) {
        if (!onlineMode) return;
        if (winnerColor === G.BLACK || winnerColor === G.WHITE) {
          game.winner = winnerColor;
          game.turn = null;
          if (winLine && winLine.length) {
            game.winLine = winLine;
            view.markWin(winLine);
          }
          refreshOnline();
        }
      },
      // 測試/除錯用
      _renderedMoves: function () { return renderedMoves; }
      };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
        // 公開 API：方便除錯與測試（非 UI 必需）
    window.GomokuApp = {
      get game() { return game; },
      get stats() { return stats; },
      get playerSide() { return playerSide; },
      setPlayerSide: function (side) {
        playerSide = normalizePlayerSide(side);
        syncSideButtons();
        saveSettings();
        newGame();
      },
      place: function (x, y) { placeAt({ x: x, y: y }); },
      finish: finish,
      share: shareResult,
      download: downloadResult,
      captureShare: makeShareCanvas,
      getShareFilename: getShareFilename,
      getBoardView: function () { return view && view.getView ? view.getView() : null; },
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
