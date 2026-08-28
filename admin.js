/* =====================================================================
 * 管理後台邏輯 — 純 vanilla JS（無打包、無 ES module）。
 * 依賴（admin.html 先載入）：Chart.js（vendor UMD，全部元件已預先註冊）。
 * 所有 /api/admin/* 皆靠 HttpOnly cookie（admin_session）驗證，
 * fetch 一律 credentials: "same-origin"。
 * ===================================================================== */
(function () {
  "use strict";

  var Chart = window.Chart || null;
  if (Chart && Chart.registerables) Chart.register.apply(Chart, Chart.registerables);

  function $(id) { return document.getElementById(id); }

  /* ==================== 常數與小工具 ==================== */

  var TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;  // UTC+8（台北時間）
  var DAY_MS = 86400000;
  var REFRESH_INTERVAL_MS = 10000;

  // 台北時區的日期字串（YYYY-MM-DD），offsetDays 可往前往後推
  function taipeiDateKey(offsetDays) {
    offsetDays = offsetDays || 0;
    return new Date(Date.now() + TAIPEI_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10);
  }

  // 時間軸標籤：日 → 日期、時 → HH、分 → HH:MM（皆為台北時間）
  function formatClock(t, granularity) {
    var date = new Date(t + TAIPEI_OFFSET_MS);
    if (granularity === "day") return date.toISOString().slice(0, 10);
    return date.toISOString().slice(11, granularity === "hour" ? 13 : 16);
  }

  function formatUptime(sec) {
    if (sec < 3600) return Math.floor(sec / 60) + " 分鐘";
    return Math.floor(sec / 3600) + " 小時 " + Math.floor((sec % 3600) / 60) + " 分";
  }

  function formatAgo(at) {
    var diff = Math.max(0, Date.now() - at);
    if (diff < 60000) return "剛剛";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分鐘前";
    if (diff < DAY_MS) return Math.floor(diff / 3600000) + " 小時前";
    return Math.floor(diff / DAY_MS) + " 天前";
  }

  function formatRemaining(expiresAt) {
    if (expiresAt === null) return "永久";
    var remaining = expiresAt - Date.now();
    if (remaining <= 0) return "即將解除";
    if (remaining < 3600000) return Math.ceil(remaining / 60000) + " 分鐘後解除";
    if (remaining < DAY_MS) return Math.ceil(remaining / 3600000) + " 小時後解除";
    return Math.ceil(remaining / DAY_MS) + " 天後解除";
  }

  function errText(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // 統一 API 呼叫：JSON、same-origin cookie、非 2xx 拋出 server 訊息
  function request(url, init) {
    init = init || {};
    init.headers = Object.assign({ "content-type": "application/json" }, init.headers || {});
    init.credentials = "same-origin";
    return fetch(url, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.message || ("HTTP " + res.status));
        return body;
      });
    });
  }

  /* ==================== 狀態 ==================== */

  var minuteChart = null;
  var hourChart = null;
  var dayChart = null;
  var refreshTimer = 0;
  var prevLive = null;        // 上一次即時快照，用於畫 ▲▼ 趨勢
  var dashboardShown = false;

  /* ==================== 畫面切換 ==================== */

  function showLogin() {
    dashboardShown = false;
    $("admin-login").hidden = false;
    $("admin-dashboard").hidden = true;
    $("btn-admin-logout").hidden = true;
    $("admin-email").textContent = "";
    setupGoogleSignIn();
  }

  function showDashboard(email) {
    dashboardShown = true;
    $("admin-login").hidden = true;
    $("admin-dashboard").hidden = false;
    $("btn-admin-logout").hidden = false;
    $("admin-email").textContent = email;
    refreshAll();
    if (!refreshTimer) refreshTimer = window.setInterval(onRefreshTick, REFRESH_INTERVAL_MS);
  }

  function destroyCharts() {
    if (minuteChart) { minuteChart.destroy(); minuteChart = null; }
    if (hourChart) { hourChart.destroy(); hourChart = null; }
    if (dayChart) { dayChart.destroy(); dayChart = null; }
  }

  // 每 10 秒輪詢一次；分頁在背景時暫停，回到前景立即補刷
  function onRefreshTick() {
    if (document.hidden || !dashboardShown) return;
    refreshAll();
  }

  /* ==================== Google 登入 ==================== */

  function loadGsiScript() {
    return new Promise(function (resolve, reject) {
      if (window.google) { resolve(); return; }
      var script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("無法載入 Google 登入元件")); };
      document.head.appendChild(script);
    });
  }

  function setupGoogleSignIn() {
    var hint = $("admin-login-hint");
    var target = $("google-signin");
    request("/api/admin/config").then(function (config) {
      if (!config.clientId) {
        hint.hidden = false;
        hint.textContent =
          "伺服器尚未設定 GOOGLE_CLIENT_ID 環境變數。請在 Google Cloud 建立 OAuth 用戶端（網頁應用程式），將此網址加入授權來源，並在 Cloud Run 設定 GOOGLE_CLIENT_ID 後重新部署。";
        return;
      }
      hint.hidden = true;
      return loadGsiScript().then(function () {
        window.google.accounts.id.initialize({
          client_id: config.clientId,
          callback: function (response) { handleGoogleCredential(response.credential); }
        });
        target.textContent = "";
        window.google.accounts.id.renderButton(target, { theme: "filled_black", size: "large", text: "signin_with", locale: "zh-TW" });
      });
    }).catch(function (error) {
      hint.hidden = false;
      hint.textContent = "無法載入登入設定：" + errText(error);
    });
  }

  function handleGoogleCredential(credential) {
    request("/api/admin/google", {
      method: "POST",
      body: JSON.stringify({ credential: credential })
    }).then(function (result) {
      showDashboard(result.email);
    }).catch(function (error) {
      var hint = $("admin-login-hint");
      hint.hidden = false;
      hint.textContent = errText(error);
    });
  }

  /* ==================== 即時指標卡 ==================== */

  function refreshAll() {
    return Promise.allSettled([
      refreshLive(),
      refreshAnnouncements(),
      refreshMinuteChart(),
      refreshHourChart(),
      refreshDayChart(),
      refreshIpPanel()
    ]);
  }

  function deltaOf(current, previous) {
    if (previous === undefined || previous === current) return undefined;
    return current - previous;
  }

  function crowdStatus(n) {
    if (n === 0) return { text: "現在很冷清…快來開一局！", tone: "muted" };
    if (n <= 2) return { text: "正好開打", tone: "ok" };
    if (n <= 6) return { text: "很熱鬧 🔥", tone: "ok" };
    return { text: "鑼鼓喧天，全場沸騰 🎉", tone: "warn" };
  }

  function cpuStatus(pct) {
    if (pct < 20) return { text: "閒得很，隨時能戰", tone: "ok" };
    if (pct < 60) return { text: "正常運作中", tone: "ok" };
    if (pct < 85) return { text: "有點忙碌 🔥", tone: "warn" };
    return { text: "滿載中，注意！", tone: "bad" };
  }

  function lagStatus(lagMs) {
    if (lagMs < 20) return { text: "順得很 ✨", tone: "ok" };
    if (lagMs < 60) return { text: "還算順", tone: "warn" };
    return { text: "有點喘 😮‍💨", tone: "bad" };
  }

  function memStatus(mb) {
    if (mb < 250) return { text: "身體健康", tone: "ok" };
    if (mb < 450) return { text: "吃得剛剛好", tone: "warn" };
    return { text: "有點吃太飽了", tone: "bad" };
  }

  function refreshLive() {
    return request("/api/admin/metrics/live").then(function (live) {
      $("admin-version").textContent = "伺服器版本 v" + live.version + " · 運行 " + formatUptime(live.uptimeSec);
      $("admin-footer-version").textContent = "v" + live.version;

      var crowd = crowdStatus(live.players);
      var cpu = cpuStatus(live.cpuPct);
      var lag = lagStatus(live.lagMs);
      var mem = memStatus(live.rssMb);
      var cards = [
        { emoji: "🧑‍🤝‍🧑", label: "連線玩家", value: String(live.players), status: crowd.text, tone: crowd.tone, delta: deltaOf(live.players, prevLive && prevLive.players) },
        { emoji: "👀", label: "觀戰人數", value: String(live.spectators), status: live.spectators === 0 ? "還沒有觀眾進場" : "有 " + live.spectators + " 人在圍觀 🍿", tone: live.spectators === 0 ? "muted" : "ok", delta: deltaOf(live.spectators, prevLive && prevLive.spectators) },
        { emoji: "🛋️", label: "大廳連線", value: String(live.lobby), status: live.lobby === 0 ? "大廳空空的" : live.lobby + " 人在逛大廳找對手", tone: live.lobby === 0 ? "muted" : "ok", delta: deltaOf(live.lobby, prevLive && prevLive.lobby) },
        { emoji: "⚔️", label: "進行戰局", value: String(live.roomsPlaying), status: live.roomsPlaying === 0 ? "棋盤們在打瞌睡 💤" : live.roomsPlaying + " 場激戰中 🔥", tone: live.roomsPlaying === 0 ? "muted" : "ok", delta: deltaOf(live.roomsPlaying, prevLive && prevLive.roomsPlaying) },
        { emoji: "🚪", label: "等待房間", value: String(live.roomsWaiting), status: live.roomsWaiting === 0 ? "沒有人在等腳友" : live.roomsWaiting + " 間房虛位以待", tone: live.roomsWaiting === 0 ? "muted" : "warn", delta: deltaOf(live.roomsWaiting, prevLive && prevLive.roomsWaiting) },
        { emoji: "🖥️", label: "CPU 使用率", value: live.cpuPct + "%", status: cpu.text, tone: cpu.tone },
        { emoji: "⚡", label: "Event-loop 延遲", value: live.lagMs + " ms", status: lag.text, tone: lag.tone },
        { emoji: "🧠", label: "記憶體 RSS", value: live.rssMb + " MB", status: "Heap " + live.heapMb + " MB · " + mem.text, tone: mem.tone }
      ];
      prevLive = live;
      renderLiveCards(cards);
    });
  }

  function renderLiveCards(cards) {
    var grid = $("admin-live-cards");
    grid.textContent = "";
    cards.forEach(function (card) {
      var cardEl = document.createElement("div");
      cardEl.className = "admin-live-card tone-" + card.tone;

      var top = document.createElement("div");
      top.className = "admin-live-top";
      var emoji = document.createElement("span");
      emoji.className = "admin-live-emoji";
      emoji.textContent = card.emoji;
      var num = document.createElement("div");
      num.className = "admin-live-num";
      num.textContent = card.value;
      top.appendChild(emoji);
      top.appendChild(num);
      if (card.delta !== undefined) {
        var delta = document.createElement("span");
        delta.className = "admin-live-delta " + (card.delta > 0 ? "up" : "down");
        delta.textContent = card.delta > 0 ? "▲" + card.delta : "▼" + Math.abs(card.delta);
        delta.title = "與 10 秒前比較";
        top.appendChild(delta);
      }

      var label = document.createElement("div");
      label.className = "admin-live-label";
      label.textContent = card.label;

      var status = document.createElement("div");
      status.className = "admin-live-status";
      status.textContent = card.status;

      cardEl.appendChild(top);
      cardEl.appendChild(label);
      cardEl.appendChild(status);
      grid.appendChild(cardEl);
    });
  }

  /* ==================== 公告 ==================== */

  function refreshAnnouncements() {
    return request("/api/admin/announcements").then(function (data) {
      var list = $("announcement-list");
      list.textContent = "";
      data.announcements.forEach(function (item) {
        var li = document.createElement("li");
        li.className = "admin-announcement-item";
        var body = document.createElement("div");
        var text = document.createElement("p");
        text.className = "admin-announcement-text";
        text.textContent = item.text;
        var meta = document.createElement("p");
        meta.className = "admin-announcement-meta";
        meta.textContent = new Date(item.at).toLocaleString("zh-TW", { hour12: false }) + " · 送達 " + item.reached + " 人";
        body.appendChild(text);
        body.appendChild(meta);
        var reads = document.createElement("span");
        reads.className = "admin-announcement-reads";
        reads.textContent = "已讀 " + item.acks + "/" + item.reached;
        li.appendChild(body);
        li.appendChild(reads);
        list.appendChild(li);
      });
    });
  }

  function sendAnnouncement() {
    var input = $("announcement-input");
    var button = $("btn-announce-send");
    var feedback = $("announce-feedback");
    var text = input.value.trim();
    if (!text) {
      feedback.textContent = "請先輸入公告內容";
      return;
    }
    button.disabled = true;
    request("/api/admin/announcements", {
      method: "POST",
      body: JSON.stringify({ text: text })
    }).then(function () {
      input.value = "";
      feedback.textContent = "已發送！";
      return refreshAnnouncements();
    }).catch(function (error) {
      feedback.textContent = errText(error);
    }).then(function () {
      button.disabled = false;
      window.setTimeout(function () { feedback.textContent = ""; }, 4000);
    });
  }

  /* ==================== 圖表（Chart.js） ==================== */

  var CHART_COLORS = ["#54d1ff", "#5be0a1", "#f0b453", "#ff7a59", "#b58bd8"];
  var CPU_COLOR = "#34d399";

  function chartColor(index) {
    return CHART_COLORS[index] || CHART_COLORS[0];
  }

  function makeDataset(spec) {
    return {
      label: spec.label,
      data: spec.data,
      borderColor: spec.color,
      backgroundColor: spec.color + "33",
      yAxisID: spec.axis,
      fill: spec.fill === true,
      tension: 0.3,
      pointRadius: 1.5,
      borderWidth: 2
    };
  }

  function baseOptions() {
    return {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { color: "#9fb0d4", maxTicksLimit: 12 }, grid: { color: "rgba(140,160,220,0.10)" } },
        y: {
          position: "left",
          beginAtZero: true,
          ticks: { color: "#9fb0d4" },
          grid: { color: "rgba(140,160,220,0.10)" },
          title: { display: true, text: "人數 / 次數", color: "#9fb0d4" }
        },
        y1: {
          position: "right",
          beginAtZero: true,
          ticks: { color: "#b58bd8", callback: function (value) { return value + " ms"; } },
          grid: { drawOnChartArea: false }
        },
        y2: {
          position: "right",
          beginAtZero: true,
          max: 100,
          ticks: { color: "#34d399", callback: function (value) { return value + "%"; } },
          grid: { drawOnChartArea: false }
        }
      },
      plugins: {
        legend: { labels: { color: "#eaf0ff", boxWidth: 12 } },
        tooltip: { callbacks: { title: function (items) { return (items[0] ? items[0].label : "") + "（台北時間）"; } } }
      }
    };
  }

  function fetchSeries(granularity, from, to) {
    return request("/api/admin/metrics/series?granularity=" + granularity + "&from=" + Math.round(from) + "&to=" + Math.round(to))
      .then(function (data) { return data.points; });
  }

  // 已有圖表就原地更新資料，否則新建（重繪不重複建 instance）
  function renderChart(existing, canvasId, labels, datasets) {
    if (existing) {
      existing.data.labels = labels;
      existing.data.datasets = datasets;
      existing.update();
      return existing;
    }
    if (!Chart) return null;
    return new Chart($(canvasId), {
      type: "line",
      data: { labels: labels, datasets: datasets },
      options: baseOptions()
    });
  }

  function refreshMinuteChart() {
    if (!Chart) return Promise.resolve();
    var rangeMinutes = Number($("minute-range").value) || 60;
    var to = Date.now();
    var from = to - rangeMinutes * 60000;
    return fetchSeries("minute", from, to).then(function (points) {
      minuteChart = renderChart(minuteChart, "chart-minute", points.map(function (p) { return formatClock(p.t, "minute"); }), [
        makeDataset({ label: "連線數（峰值）", data: points.map(function (p) { return p.connPeak; }), color: chartColor(0), axis: "y", fill: true }),
        makeDataset({ label: "進行戰局", data: points.map(function (p) { return p.roomsPlayingPeak; }), color: chartColor(1), axis: "y" }),
        makeDataset({ label: "WS 訊息/分", data: points.map(function (p) { return p.wsMsg; }), color: chartColor(2), axis: "y" }),
        makeDataset({ label: "HTTP 請求/分", data: points.map(function (p) { return p.http; }), color: chartColor(3), axis: "y" }),
        makeDataset({ label: "CPU %", data: points.map(function (p) { return p.cpuPeak || 0; }), color: CPU_COLOR, axis: "y2" }),
        makeDataset({ label: "Event-loop lag p95", data: points.map(function (p) { return p.lagP95 || 0; }), color: chartColor(4), axis: "y1" })
      ]);
    });
  }

  function refreshHourChart() {
    if (!Chart) return Promise.resolve();
    var date = $("hour-date").value || taipeiDateKey();
    var from = Date.parse(date + "T00:00:00+08:00");
    var to = from + DAY_MS - 1;
    return fetchSeries("hour", from, to).then(function (points) {
      hourChart = renderChart(hourChart, "chart-hour", points.map(function (p) { return formatClock(p.t, "hour") + ":00"; }), [
        makeDataset({ label: "連線數（峰值）", data: points.map(function (p) { return p.connPeak; }), color: chartColor(0), axis: "y", fill: true }),
        makeDataset({ label: "平均連線", data: points.map(function (p) { return Math.round((p.connSum / Math.max(1, p.samples)) * 100) / 100; }), color: chartColor(3), axis: "y" }),
        makeDataset({ label: "進行戰局（峰值）", data: points.map(function (p) { return p.roomsPlayingPeak; }), color: chartColor(1), axis: "y" }),
        makeDataset({ label: "WS 訊息/時", data: points.map(function (p) { return p.wsMsg; }), color: chartColor(2), axis: "y" }),
        makeDataset({ label: "HTTP 請求/時", data: points.map(function (p) { return p.http; }), color: chartColor(4), axis: "y" }),
        makeDataset({ label: "CPU 峰值 %", data: points.map(function (p) { return p.cpuPeak || 0; }), color: CPU_COLOR, axis: "y2" }),
        makeDataset({ label: "Event-loop lag p95", data: points.map(function (p) { return p.lagP95Max || 0; }), color: chartColor(4), axis: "y1" })
      ]);
    });
  }

  function refreshDayChart() {
    if (!Chart) return Promise.resolve();
    var days = Number($("day-range").value) || 7;
    var to = Date.now();
    var from = to - days * DAY_MS;
    return fetchSeries("day", from, to).then(function (points) {
      dayChart = renderChart(dayChart, "chart-day", points.map(function (p) { return p.day || formatClock(p.t, "day"); }), [
        makeDataset({ label: "連線數（峰值）", data: points.map(function (p) { return p.connPeak; }), color: chartColor(0), axis: "y", fill: true }),
        makeDataset({ label: "平均連線", data: points.map(function (p) { return Math.round((p.connSum / Math.max(1, p.samples)) * 100) / 100; }), color: chartColor(3), axis: "y" }),
        makeDataset({ label: "進行戰局（峰值）", data: points.map(function (p) { return p.roomsPlayingPeak; }), color: chartColor(1), axis: "y" }),
        makeDataset({ label: "WS 訊息/天", data: points.map(function (p) { return p.wsMsg; }), color: chartColor(2), axis: "y" }),
        makeDataset({ label: "HTTP 請求/天", data: points.map(function (p) { return p.http; }), color: chartColor(4), axis: "y" }),
        makeDataset({ label: "CPU 峰值 %", data: points.map(function (p) { return p.cpuPeak || 0; }), color: CPU_COLOR, axis: "y2" }),
        makeDataset({ label: "Event-loop lag p95", data: points.map(function (p) { return p.lagP95Max || 0; }), color: chartColor(4), axis: "y1" })
      ]);
    });
  }

  /* ==================== IP 監控與封鎖 ==================== */

  // 異常類型 → 中文顯示名
  var IP_ALERT_TYPE_TEXT = {
    "http-flood": "HTTP 洪水",
    "ws-flood": "WS 訊息洪水",
    "conn-storm": "連線風暴",
    "http-hourly": "HTTP 時流量異常"
  };

  function selectedBlockDuration() {
    return $("ip-block-duration").value;
  }

  function ipFeedback(text) {
    var feedback = $("ip-feedback");
    feedback.textContent = text;
    window.setTimeout(function () { feedback.textContent = ""; }, 4000);
  }

  function blockIp(ip) {
    var duration = selectedBlockDuration();
    return request("/api/admin/ip-blocks", {
      method: "POST",
      body: JSON.stringify({ ip: ip, duration: duration })
    }).then(function () {
      ipFeedback("已封鎖 " + ip + "（" + (duration === "permanent" ? "永久" : duration) + "）");
      return refreshIpPanel();
    });
  }

  function unblockIp(ip) {
    return request("/api/admin/ip-blocks/" + encodeURIComponent(ip), { method: "DELETE" }).then(function () {
      ipFeedback("已解除封鎖：" + ip);
      return refreshIpPanel();
    });
  }

  function toggleBlockButton(action, blocked, ip) {
    action.disabled = true;
    var job = blocked ? unblockIp(ip) : blockIp(ip);
    job.catch(function (error) { ipFeedback(errText(error)); }).then(function () {
      action.disabled = false;
    });
  }

  function refreshIpPanel() {
    return Promise.all([
      request("/api/admin/ip-stats?range=" + encodeURIComponent($("ip-range").value)),
      request("/api/admin/ip-alerts"),
      request("/api/admin/ip-blocks")
    ]).then(function (results) {
      renderIpStats(results[0]);
      renderIpAlerts(results[1]);
      renderIpBlocks(results[2]);
    });
  }

  function renderIpStats(stats) {
    var body = $("ip-top-body");
    body.textContent = "";
    if (stats.points.length === 0) {
      var emptyRow = body.insertRow();
      var emptyCell = emptyRow.insertCell();
      emptyCell.colSpan = 9;
      emptyCell.textContent = "這段時間內沒有流量紀錄";
      emptyCell.className = "admin-empty";
      return;
    }
    stats.points.forEach(function (row, index) {
      var tr = body.insertRow();
      if (row.blocked) tr.className = "blocked-row";
      [String(index + 1), row.ip, String(row.http), String(row.wsMsg), String(row.connEvents), String(row.concurrent), formatAgo(row.lastSeen)].forEach(function (value) {
        var cell = tr.insertCell();
        cell.textContent = value;
      });
      tr.cells[1].className = "mono";   // IP 欄用等寬字型

      var statusCell = tr.insertCell();
      var pill = document.createElement("span");
      pill.className = "ip-status-pill " + (row.blocked ? "blocked" : "ok");
      pill.textContent = row.blocked ? "封鎖中（" + formatRemaining(row.blockExpiresAt) + "）" : "正常";
      statusCell.appendChild(pill);

      var actionCell = tr.insertCell();
      var action = document.createElement("button");
      action.type = "button";
      action.className = "admin-btn small " + (row.blocked ? "ghost" : "primary");
      action.textContent = row.blocked ? "解封" : "封鎖";
      action.addEventListener("click", function () {
        toggleBlockButton(action, row.blocked, row.ip);
      });
      actionCell.appendChild(action);
    });
  }

  function renderIpAlerts(alertsData) {
    $("ip-thresholds").textContent =
      "異常閥值：單一 IP HTTP > " + alertsData.thresholds.httpPerMin + " 次/分、WS 訊息 > " + alertsData.thresholds.wsPerMin + " 則/分、" +
      "WS 連線 > " + alertsData.thresholds.connPerMin + " 條/分、HTTP > " + alertsData.thresholds.httpPerHour + " 次/時 · 流量歷史保留 " + alertsData.thresholds.retentionDays + " 天";

    var alertsList = $("ip-alerts-list");
    alertsList.textContent = "";
    if (alertsData.alerts.length === 0) {
      var empty = document.createElement("li");
      empty.className = "admin-empty";
      empty.textContent = "目前沒有異常警示 — 一切平靜 ✨";
      alertsList.appendChild(empty);
      return;
    }
    alertsData.alerts.slice(0, 20).forEach(function (alert) {
      var li = document.createElement("li");
      li.className = "admin-announcement-item ip-alert-item";
      var body = document.createElement("div");
      var text = document.createElement("p");
      text.className = "admin-announcement-text";
      var type = document.createElement("span");
      type.className = "ip-alert-type";
      type.textContent = IP_ALERT_TYPE_TEXT[alert.type] || alert.type;
      text.appendChild(type);
      text.appendChild(document.createTextNode(alert.detail));
      var meta = document.createElement("p");
      meta.className = "admin-announcement-meta";
      meta.textContent = alert.ip + " · " + new Date(alert.at).toLocaleString("zh-TW", { hour12: false });
      body.appendChild(text);
      body.appendChild(meta);
      li.appendChild(body);
      alertsList.appendChild(li);
    });
  }

  function renderIpBlocks(blocksData) {
    var blocksList = $("ip-blocks-list");
    blocksList.textContent = "";
    if (blocksData.blocks.length === 0) {
      var empty = document.createElement("li");
      empty.className = "admin-empty";
      empty.textContent = "目前沒有封鎖任何 IP";
      blocksList.appendChild(empty);
      return;
    }
    blocksData.blocks.forEach(function (block) {
      var li = document.createElement("li");
      li.className = "admin-announcement-item ip-block-item";
      var body = document.createElement("div");
      var text = document.createElement("p");
      text.className = "admin-announcement-text";
      text.textContent = block.ip;
      var meta = document.createElement("p");
      meta.className = "admin-announcement-meta";
      meta.textContent = "封鎖於 " + new Date(block.blockedAt).toLocaleString("zh-TW", { hour12: false }) + " · " + formatRemaining(block.expiresAt) + " · 由 " + (block.blockedBy || "管理員") + " 設定";
      body.appendChild(text);
      body.appendChild(meta);
      var action = document.createElement("button");
      action.type = "button";
      action.className = "admin-btn ghost small";
      action.textContent = "解封";
      action.addEventListener("click", function () {
        action.disabled = true;
        unblockIp(block.ip).catch(function (error) { ipFeedback(errText(error)); }).then(function () {
          action.disabled = false;
        });
      });
      li.appendChild(body);
      li.appendChild(action);
      blocksList.appendChild(li);
    });
  }

  /* ==================== 啟動 ==================== */

  function boot() {
    // 頁尾版本：先向前台既有的 /api/health 拿版號（登入前也看得到），登入後會被 live 指標覆寫
    fetch("/api/health", { credentials: "same-origin" }).then(function (res) { return res.json(); }).then(function (data) {
      if (data && data.version) $("admin-footer-version").textContent = "v" + data.version;
    }).catch(function () { /* 版號拿不到就算了 */ });

    $("btn-announce-send").addEventListener("click", sendAnnouncement);
    $("btn-admin-logout").addEventListener("click", function () {
      request("/api/admin/logout", { method: "POST" }).catch(function () { /* 登出失敗也照樣回到登入頁 */ });
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
        refreshTimer = 0;
      }
      destroyCharts();
      prevLive = null;
      showLogin();
    });
    $("btn-refresh-minute").addEventListener("click", function () { refreshMinuteChart(); });
    $("minute-range").addEventListener("change", function () { refreshMinuteChart(); });
    $("day-range").addEventListener("change", function () { refreshDayChart(); });
    $("btn-ip-refresh").addEventListener("click", function () { refreshIpPanel(); });
    $("ip-range").addEventListener("change", function () { refreshIpPanel(); });
    $("btn-ip-block-manual").addEventListener("click", function () {
      var input = $("ip-manual-input");
      var ip = input.value.trim();
      if (!ip) {
        ipFeedback("請先輸入 IP 位址");
        return;
      }
      input.value = "";
      blockIp(ip).catch(function (error) { ipFeedback(errText(error)); });
    });
    $("hour-date").value = taipeiDateKey();
    $("hour-date").addEventListener("change", function () { refreshHourChart(); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-hour-shift]"), function (button) {
      button.addEventListener("click", function () {
        var shift = Number(button.getAttribute("data-hour-shift")) || 0;
        $("hour-date").value = taipeiDateKey(shift);
        refreshHourChart();
      });
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && dashboardShown) refreshAll();
    });

    request("/api/admin/session").then(function (session) {
      if (session.authenticated && session.email) showDashboard(session.email);
      else showLogin();
    }).catch(function () {
      showLogin();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();