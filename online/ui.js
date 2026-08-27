/* =====================================================================
 * 線上流程黏合（Part 1）：探測、路由、建立/加入/觀戰、邀請頁、戰情中心。
 * 依賴（index.html 先載入）：Game, Protocol, ReconnectingSocket,
 * OnlineTokens, OnlineSession, GomokuApp, GomokuOnline
 * ===================================================================== */
(function () {
  "use strict";
  var P = window.Protocol;
  if (!P || !window.ReconnectingSocket || !window.OnlineSession || !window.OnlineTokens || !window.GomokuOnline) return;

  function $(id) { return document.getElementById(id); }
  var els = {
    layer: $("online-layer"), home: $("screen-home"), setup: $("screen-setup"),
    join: $("screen-join"), wait: $("screen-wait"),
    btnCreate: $("btn-online-create"), btnLocal: $("btn-local-play"),
    wsBadge: $("ws-badge"), warCenter: $("war-center"), warList: $("war-list"),
    warEmpty: $("war-empty"), warGames: $("war-games"), warPlayers: $("war-players"), warSpectators: $("war-spectators"),
    setupName: $("setup-name"), btnCreateRoom: $("btn-create-room"), btnSetupBack: $("btn-setup-back"),
    rulesetDesc: $("ruleset-desc"),
    joinTitle: $("join-title"), joinHint: $("join-hint"), joinName: $("join-name"),
    btnJoinRoom: $("btn-join-room"), btnJoinBack: $("btn-join-back"),
    inviteUrl: $("invite-url"), btnCopy: $("btn-copy-invite"), qr: $("invite-qr"), btnWaitCancel: $("btn-wait-cancel"),
    version: $("online-version"),
    hud: $("online-hud"), opponentStatus: $("opponent-status"), turnTimer: $("turn-timer"),
    btnChat: $("btn-chat"), chatBadge: $("chat-badge"), btnMenu: $("btn-online-menu"),
    reconnect: $("reconnect-overlay"),
    drawer: $("chat-drawer"), drawerHead: $("drawer-head"), drawerClose: $("drawer-close"),
    tabChat: $("tab-chat"), tabPeople: $("tab-people"), paneChat: $("pane-chat"), panePeople: $("pane-people"),
    chatList: $("chat-list"), chatChips: $("chat-chips"), chatForm: $("chat-form"), chatInput: $("chat-input"),
    chatBadgeTab: $("tab-chat-badge"), peopleBadgeTab: $("tab-people-badge"),
    peoplePlayers: $("people-players"), peopleSpectators: $("people-spectators"), peopleSpecCount: $("people-spec-count"),
    dialog: $("online-dialog"), odTitle: $("od-title"), odSub: $("od-sub"), odOk: $("od-ok"), odCancel: $("od-cancel"),
    menu: $("online-menu"), menuClose: $("menu-close"),
    menuCopy: $("menu-copy"), menuDraw: $("menu-draw"), menuAbort: $("menu-abort"), menuResign: $("menu-resign"), menuLeave: $("menu-leave"),
    ovRematch: $("ov-rematch")
  };
  if (!els.layer) return;

  var RULESET_DESC = {
    freestyle: "自由五子棋：黑白對等無禁手，五連（含長連）即勝。",
    standard: "標準無禁五子棋：黑白對等，剛好五連才算勝。",
    renju: "連珠（黑棋禁手）：黑棋受三三／四四／長連禁手限制，首犯退回、再犯判負。"
  };

  /* ==================== 狀態 ==================== */
  var selectedRuleset = "standard";
  var session = null;          // OnlineSession（房間）
  var lobbySocket = null;      // 戰情中心 WS
  var currentRoomId = null;
  var mySeat = null;
  var spectate = false;
  var presence = null;
  var lastStateDTO = null;
  var lastResultShown = false;
  var drawerOpen = false;
  var drawerTab = "chat";
  var unreadChat = 0;
  var unreadPeople = 0;
  var lastLobbySnapshot = null;
  var pollTimer = null;
  var wsDown = false;
  var serverOk = false;
  var notifyTimer = null;
  var originalTitle = document.title;
  var confirmHandler = null;
  var confirmCancelHandler = null;
  var lastDeadlineInfo = null;
  var yourTurnAlarm = false;

  /* ==================== 工具 ==================== */

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function toast(msg) {
    var toastEl = $("toast");
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      setTimeout(function () { toastEl.classList.remove("show"); }, 3600);
    }
  }

  function fmtClock(ms) {
    if (ms == null || ms < 0) ms = 0;
    var s = Math.ceil(ms / 1000);
    var m = Math.floor(s / 60);
    return m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  function roomIdTail(roomId) { return "#" + roomId.slice(-4).toUpperCase(); }

  function seatNameOf(index) {
    if (!presence || !presence.seats || !presence.seats[index]) return null;
    return presence.seats[index].name || null;
  }

  function opponentSeat() { return mySeat === 0 ? 1 : 0; }

  // ---END-OF-HELPERS---

  /* ==================== 畫面路由 ==================== */

  function showScreen(name) {
    hideEntryScreen();
    ["home", "setup", "join", "wait"].forEach(function (n) {
      var el = $("screen-" + n);
      if (n === name) show(el); else hide(el);
    });
    show(els.layer);
    if (name === "home") startLobby(); else stopLobby();
  }

  // 入口首頁收起（app.js 預設顯示，線上流程接管時收起）
  function hideEntryScreen() {
    var el = document.getElementById("screen-entry");
    if (el) el.classList.add("hidden");
    if (document.body) document.body.classList.remove("entry-open");
  }

  function showGameView() {
    hideEntryScreen();
    hide(els.layer);
    show(els.hud);
    stopLobby();
  }

  // 回到純本地遊戲（收起線上層）
  function hideOnlineLayer() {
    hide(els.layer);
    stopLobby();
  }

  function leaveRoom() {
    if (session) { session.dispose(); session = null; }
    currentRoomId = null;
    mySeat = null;
    presence = null;
    lastStateDTO = null;
    lastResultShown = false;
    unreadChat = unreadPeople = 0;
    updateBadges();
    hide(els.hud);
    hide(els.reconnect);
    hide(els.drawer);
    drawerOpen = false;
    hide(els.dialog);
    hide(els.menu);
    els.ovRematch.hidden = true;
    document.title = originalTitle;
    window.GomokuOnline.leave();
    history.replaceState(null, "", "/");
    showScreen("home");
  }

  /* ==================== 確認 dialog ==================== */

  function openConfirm(title, sub, okText, onOk, cancelText, onCancel) {
    els.odTitle.textContent = title;
    els.odSub.textContent = sub || "";
    els.odOk.textContent = okText || "確定";
    els.odCancel.textContent = cancelText || "取消";
    confirmHandler = onOk || null;
    confirmCancelHandler = onCancel || null;
    show(els.dialog);
  }

  function closeConfirm() {
    hide(els.dialog);
    confirmHandler = null;
    confirmCancelHandler = null;
  }

  /* ==================== /api/health 探測與啟動 ==================== */

  function probeHealth() {
    fetch("/api/health", { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("bad status");
      return res.json();
    }).then(function (data) {
      if (!data || !data.ok) throw new Error("bad payload");
      serverOk = true;
      if (data.version) els.version.textContent = "五子棋 · Five Chess v" + data.version;
      var entryOnline = document.getElementById("btn-entry-online");
      if (entryOnline) entryOnline.hidden = false; // 入口首頁的線上對戰按鈕
      bootRoute();
    }).catch(function () {
      serverOk = false; // 純靜態部署：隱藏整個線上功能
      var note = document.getElementById("entry-offline-note");
      if (note) note.hidden = false;
    });
  }

  function parseRoomFromPath() {
    var m = location.pathname.match(/^\/r\/([a-z2-9]{10})$/i);
    return m ? m[1].toLowerCase() : null;
  }

  function bootRoute() {
    var roomId = parseRoomFromPath();
    if (roomId) {
      hideEntryScreen(); // 邀請連結直入線上流程
      openRoomUrl(roomId);
    } else if (location.search.indexOf("spectate=1") >= 0) {
      // 從戰情中心過來但路徑缺房號（罕見）：回 home
      showScreen("home");
    }
  }

  // /r/:roomId 開頁：有 token 就靜默重連，否則進暱稱頁
  function openRoomUrl(roomId) {
    var saved = window.OnlineTokens.loadToken(roomId);
    if (saved) {
      currentRoomId = roomId;
      openOnlineSession(roomId, { playerToken: saved, name: window.OnlineTokens.loadName() || null, spectate: false });
      return;
    }
    openJoinScreen(roomId, location.search.indexOf("spectate=1") >= 0);
  }

  /* ==================== 建立 / 加入 / 觀戰 ==================== */

  function openSetupScreen() {
    showScreen("setup");
    els.setupName.value = window.OnlineTokens.loadName() || "";
    syncRulesetButtons();
  }

  function syncRulesetButtons() {
    document.querySelectorAll(".ruleset-seg [data-ruleset]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-ruleset") === selectedRuleset ? "true" : "false");
    });
    els.rulesetDesc.textContent = RULESET_DESC[selectedRuleset];
  }

  document.querySelectorAll(".ruleset-seg [data-ruleset]").forEach(function (b) {
    b.addEventListener("click", function () {
      selectedRuleset = b.getAttribute("data-ruleset");
      syncRulesetButtons();
    });
  });

  function createRoom() {
    var name = els.setupName.value.trim() || "玩家一";
    window.OnlineTokens.saveName(name);
    els.btnCreateRoom.disabled = true;
    fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name, ruleset: selectedRuleset })
    }).then(function (res) { return res.json(); }).then(function (data) {
      els.btnCreateRoom.disabled = false;
      if (!data || !data.roomId) throw new Error("no roomId");
      window.OnlineTokens.saveToken(data.roomId, data.playerToken);
      history.replaceState(null, "", "/r/" + data.roomId);
      currentRoomId = data.roomId;
      spectate = false;
      openOnlineSession(data.roomId, { playerToken: data.playerToken, name: name, spectate: false });
    }).catch(function () {
      els.btnCreateRoom.disabled = false;
      toast("建立房間失敗，請確認網路後再試");
    });
  }

  function openJoinScreen(roomId, wantSpectate) {
    currentRoomId = roomId;
    spectate = !!wantSpectate;
    els.joinTitle.textContent = wantSpectate ? "進入觀戰" : "加入對戰";
    els.joinHint.textContent = wantSpectate
      ? "以觀眾身分進場：可以在聊天室裡幫喊加油，但不能下棋。"
      : "若座位已滿，將以觀眾身分進場（可聊天，不能下棋）。";
    els.joinName.value = window.OnlineTokens.loadName() || "";
    showScreen("join");
  }

  function joinRoom() {
    var name = els.joinName.value.trim() || (spectate ? "觀眾" : "玩家二");
    window.OnlineTokens.saveName(name);
    openOnlineSession(currentRoomId, { playerToken: null, name: name, spectate: spectate });
  }

  /* ==================== 戰情中心 ==================== */

  function startLobby() {
    if (!serverOk) return;
    els.warCenter.hidden = false;
    if (lobbySocket) return;
    lobbySocket = new window.ReconnectingSocket({
      onOpen: function () {
        wsDown = false;
        setWsBadge(true);
        lobbySocket.send({ t: "subscribeLobby" });
      },
      onMessage: function (msg) {
        if (msg && msg.t === "lobby") renderLobby(msg.games || []);
      },
      onDown: function () {
        wsDown = true;
        setWsBadge(false);
        startPolling();
      }
    });
    lobbySocket.connect();
    fetchGames(); // 先打一輪 HTTP 立即顯示
  }

  function stopLobby() {
    if (lobbySocket) { lobbySocket.close(); lobbySocket = null; }
    stopPolling();
  }

  function setWsBadge(up) {
    els.wsBadge.textContent = up ? "即時連線中" : "重新連線中…";
    els.wsBadge.className = "ws-badge " + (up ? "on" : "off");
  }

  function startPolling() {
    if (pollTimer || !serverOk) return;
    pollTimer = setInterval(function () {
      if (document.hidden) return;      // 頁面隱藏時暫停輪詢
      if (!wsDown) return;              // WS 通時以推播為準
      fetchGames();
    }, 10_000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function fetchGames() {
    if (!serverOk) return;
    fetch("/api/games", { cache: "no-store" }).then(function (res) { return res.json(); })
      .then(function (data) { if (data && data.games) renderLobby(data.games); })
      .catch(function () { /* 忽略 */ });
  }

  // ---END-OF-LOBBY---

  /* ==================== war cards 渲染 ==================== */

  function renderLobby(games) {
    var snapshot = JSON.stringify(games);
    var prev = null;
    try { prev = lastLobbySnapshot ? JSON.parse(lastLobbySnapshot) : null; } catch (e) { prev = null; }
    lastLobbySnapshot = snapshot;

    els.warGames.textContent = String(games.length);
    els.warPlayers.textContent = String(games.length * 2);
    var specTotal = 0;
    games.forEach(function (g) { specTotal += g.spectators || 0; });
    els.warSpectators.textContent = String(specTotal);

    // war cards
    els.warList.textContent = "";
    games.forEach(function (g) {
      els.warList.appendChild(warCard(g, prev));
    });
    if (els.warEmpty) els.warEmpty.hidden = games.length > 0;
  }

  function warCard(g, prev) {
    var card = document.createElement("div");
    card.className = "war-card";

    var changed = prev && prev.some(function (old) {
      return old.roomId === g.roomId &&
        (old.turnNumber !== g.turnNumber || old.blackCount !== g.blackCount || old.whiteCount !== g.whiteCount);
    });
    if (changed) card.classList.add("flash");

    var head = document.createElement("div");
    head.className = "war-card-head";
    var id = document.createElement("span");
    id.className = "war-roomid";
    id.textContent = roomIdTail(g.roomId);
    head.appendChild(id);
    var live = document.createElement("span");
    live.className = "war-live";
    live.textContent = "交戰中";
    head.appendChild(live);
    var tag = document.createElement("span");
    tag.className = "war-tag";
    tag.textContent = warTag(g);
    if (tag.textContent) head.appendChild(tag);
    var eyes = document.createElement("span");
    eyes.className = "war-specs";
    eyes.textContent = "👁️ " + (g.spectators || 0);
    head.appendChild(eyes);
    card.appendChild(head);

    var duel = document.createElement("div");
    duel.className = "war-duel";
    duel.appendChild(warPlayer(g.players[0], "black", g.blackCount, "黑方"));
    var vs = document.createElement("div");
    vs.className = "war-vs";
    vs.innerHTML = ""; // textContent only
    var vsTxt = document.createElement("div");
    vsTxt.className = "vs-mark";
    vsTxt.textContent = "VS";
    var turnTxt = document.createElement("div");
    turnTxt.className = "vs-turn";
    turnTxt.textContent = "第 " + g.turnNumber + " 手";
    vs.appendChild(vsTxt);
    vs.appendChild(turnTxt);
    duel.appendChild(vs);
    duel.appendChild(warPlayer(g.players[1], "white", g.whiteCount, "白方"));
    card.appendChild(duel);

    var balance = document.createElement("div");
    balance.className = "war-balance";
    var bar = document.createElement("div");
    bar.className = "balance-bar";
    var total = g.blackCount + g.whiteCount;
    var pct = total ? Math.round(g.blackCount / total * 100) : 50;
    var blackFill = document.createElement("div");
    blackFill.className = "fill black";
    blackFill.style.width = pct + "%";
    bar.appendChild(blackFill);
    balance.appendChild(bar);
    var balanceText = document.createElement("div");
    balanceText.className = "balance-text";
    balanceText.textContent = "黑方 " + g.blackCount + " 子 · 白方 " + g.whiteCount + " 子";
    balance.appendChild(balanceText);
    card.appendChild(balance);

    var foot = document.createElement("div");
    foot.className = "war-card-foot";
    var footInfo = document.createElement("span");
    footInfo.textContent = "已下 " + (g.blackCount + g.whiteCount) + " 子 · 黑 " + g.blackCount + " / 白 " + g.whiteCount;
    foot.appendChild(footInfo);
    var btn = document.createElement("button");
    btn.className = "btn small";
    btn.type = "button";
    btn.textContent = "進入觀戰";
    btn.addEventListener("click", function () {
      goSpectate(g.roomId);
    });
    foot.appendChild(btn);
    card.appendChild(foot);
    return card;
  }

  function warPlayer(player, side, count, label) {
    var box = document.createElement("div");
    box.className = "war-player " + side;
    var dot = document.createElement("span");
    dot.className = "war-dot " + side;
    box.appendChild(dot);
    var info = document.createElement("div");
    var nm = document.createElement("div");
    nm.className = "war-player-name";
    nm.textContent = (player && player.name) || "（等待中）";
    info.appendChild(nm);
    var sub = document.createElement("div");
    sub.className = "war-player-sub";
    sub.textContent = player && player.name ? label + " · " + count + " 子" : "陣營待定";
    info.appendChild(sub);
    box.appendChild(info);
    return box;
  }

  // 標籤：膠著🔥（手數≥10 且黑白平衡）／激戰⚔️（手數≥30）
  function warTag(g) {
    if (g.turnNumber >= 30) return "激戰 ⚔️";
    if (g.turnNumber >= 10 && g.blackCount === g.whiteCount) return "膠著 🔥";
    return "";
  }

  function goSpectate(roomId) {
    history.replaceState(null, "", "/r/" + roomId + "?spectate=1");
    currentRoomId = roomId;
    spectate = true;
    openOnlineSession(roomId, { playerToken: window.OnlineTokens.loadToken(roomId), name: window.OnlineTokens.loadName() || "觀眾", spectate: true });
  }

  // ---END-OF-WAR---

  /* ==================== OnlineSession 建立與訊息路由 ==================== */

  function openOnlineSession(roomId, opts) {
    if (session) session.dispose();
    currentRoomId = roomId;
    lastResultShown = false;
    unreadChat = unreadPeople = 0;
    updateBadges();

    session = new window.OnlineSession({
      roomId: roomId,
      playerToken: opts.playerToken || null,
      name: opts.name || null,
      spectate: !!opts.spectate,
      onJoined: onJoined,
      onState: onServerState,
      onActionApplied: onActionApplied,
      onInvalid: onInvalid,
      onChat: onChatMessage,
      onChatHistory: onChatHistory,
      onPresence: onPresence,
      onCountdown: onCountdown,
      onDrawOffered: function (by) { onNegotiationOffered("draw", by); },
      onDrawRejected: function (by) { onNegotiationRejected("draw", by); },
      onAbortOffered: function (by) { onNegotiationOffered("abort", by); },
      onAbortRejected: function (by) { onNegotiationRejected("abort", by); },
      onRematchOffered: function (by) { onNegotiationOffered("rematch", by); },
      onRematchRejected: function (by) { onNegotiationRejected("rematch", by); },
      onRematchStart: onRematchStart,
      onGameOver: onGameOver,
      onConnectionChanged: onConnectionChanged,
      onRoomNotFound: onRoomNotFound,
      onRateLimited: onRateLimited,
      onConnectedElsewhere: onConnectedElsewhere,
      onError: function (msg) { toast(msg.message || "發生錯誤"); }
    });
    window.__onlineSession = session; // 除錯/支援用把手
    session.connect();
  }

  // 協商提議：對方（坐著的）提出 → 彈 dialog 徵詢；我方提出（廣播回來）→ 系統公告；觀眾只看到公告
  function onNegotiationOffered(kind, by) {
    if (by === mySeat) {
      var mine = { draw: "你提出了和棋，等待對方回應…", abort: "你提議提前結束對戰，等待對方回應…", rematch: "你提議再來一局，等待對方回應…" };
      systemNotice(mine[kind]);
      return;
    }
    if (mySeat === null) {
      var watchText = { draw: "對手提議和棋中…", abort: "對手提議提前結束對戰中…", rematch: "對手提議再來一局中…" };
      systemNotice(watchText[kind] || "對手提出協商");
      return;
    }
    var who = seatNameOf(by) || "對手";
    if (kind === "draw") {
      openConfirm("對手提議和棋", who + " 提議雙方和棋結束本局。", "同意和棋", function () {
        session && session.respondDraw(true);
      }, "繼續下", function () {
        session && session.respondDraw(false);
      });
    } else if (kind === "abort") {
      openConfirm("對手提議提前結束", who + " 提議提前結束對戰（不計勝負）。", "同意結束", function () {
        session && session.respondAbort(true);
      }, "繼續下", function () {
        session && session.respondAbort(false);
      });
    } else if (kind === "rematch") {
      openConfirm("對手提議再來一局", who + " 想再來一局（重洗、換先手）。", "接受", function () {
        session && session.respondRematch(true);
      }, "婉拒", function () {
        session && session.respondRematch(false);
      });
    }
  }

  function onNegotiationRejected(kind, by) {
    if (by === mySeat) return; // 我自己婉拒的不用公告
    var text = { draw: "對方不同意和棋，繼續下！", abort: "對方不同意結束對戰，繼續下！", rematch: "對方暫時不想再來一局" };
    systemNotice(text[kind] || "對方拒絕了提議");
  }
  // (onNegotiationRejected defined above)

  function onJoined(msg) {
    mySeat = msg.seat;
    // 觀戰身分由座位決定：seat === null 即為觀眾
    spectate = msg.seat === null;

    if (msg.roomStatus === "waiting" && mySeat !== null) {
      // 建立者在等待畫面
      showWaitScreen(msg);
      return;
    }
    enterGameWithState(msg);
    // 重連/加入已結束的房間：直接呈現終局
    if (msg.roomStatus === "finished" && msg.gameOver) {
      showFinishedResult(msg.gameOver, msg.state);
    }
  }

  function showFinishedResult(gameOver, stateDto) {
    var seated = mySeat === 0 || mySeat === 1;
    var blackSeat = session ? session.blackSeat : 0;
    // 逾時/認輸/斷線判負等終局不反映在 moves 上，需顯式標記鏡像對局
    var winnerColor = null;
    if (gameOver.winnerIndex === 0 || gameOver.winnerIndex === 1) {
      winnerColor = gameOver.winnerIndex === blackSeat ? 1 : 2; // Game.BLACK / Game.WHITE
    }
    if (stateDto && stateDto.winner != null) winnerColor = stateDto.winner; // 盤面已定勝負（五連/禁手/滿盤）
    window.GomokuOnline.markFinished(winnerColor === 2 ? 2 : (winnerColor === 1 ? 1 : null), stateDto ? stateDto.winLine : null);
    window.GomokuOnline.showResult({
      reasonText: gameOver.reasonText || P.reasonText(gameOver.reason),
      winnerSeat: gameOver.winnerIndex,
      blackSeat: blackSeat,
      mySeat: mySeat,
      spectate: mySeat === null,
      moveNumber: stateDto ? stateDto.moveNumber : 0
    });
    if (seated) els.ovRematch.hidden = false;
  }

  function onServerState(msg) {
    // 對手遞補入座：waiting → playing，等待方直接開打
    if (msg.roomStatus === "playing" && (els.wait && !els.wait.classList.contains("hidden"))) {
      showGameView();
      enterGame(msg);
    }
    if (window.GomokuOnline.isActive()) {
      lastStateDTO = msg.state;
      window.GomokuOnline.applyState(msg.state);
    }
  }

  function enterGameWithState(msg) {
    showGameView();
    enterGame(msg);
  }

  function enterGame(msg) {
    lastStateDTO = msg.state;
    window.GomokuOnline.enter({
      mySeat: mySeat,
      spectate: mySeat === null,
      blackSeat: msg.blackSeat || 0,
      ruleset: msg.state.ruleset
    });
    window.GomokuOnline.applyState(msg.state);
    if (mySeat !== null) window.OnlineTokens.saveName(window.OnlineTokens.loadName() || els.joinName.value.trim() || (mySeat === 0 ? "玩家一" : "玩家二"));
    renderPeople(presence);
    syncMenuAvailability();
  }

  function showWaitScreen(msg) {
    showScreen("wait");
    var url = location.origin + "/r/" + msg.roomId;
    els.inviteUrl.value = url;
    loadQr(url);
    // 同時進入遊戲底層（空白棋盤），對手遞補時收到 state 直接開打
    window.GomokuOnline.enter({ mySeat: msg.seat, spectate: false, blackSeat: msg.blackSeat || 0, ruleset: msg.state.ruleset });
    window.GomokuOnline.applyState(msg.state);
  }

  function onActionApplied(msg) {
    lastStateDTO = msg.state;
    window.GomokuOnline.applyState(msg.state);
  }

  function onInvalid(msg) {
    if (msg.code === "forbidden-warn" && msg.warn) {
      var typeName = msg.warn.type === "overline" ? "長連" : msg.warn.type === "doubleFour" ? "四四" : "三三";
      toast("「" + typeName + "」禁手：首次違規退回此手，請改下其他位置");
      return;
    }
    toast(msg.message || "動作被拒");
  }

  function onChatHistory(list) {
    els.chatList.textContent = "";
    (list || []).forEach(function (m) { appendChatMessage(m, true); });
    scrollChatBottom(true);
  }

  function onChatMessage(msg) {
    appendChatMessage(msg, false);
    scrollChatBottom(false);
    if (!drawerOpen || drawerTab !== "chat") {
      unreadChat = Math.min(unreadChat + 1, 99);
      updateBadges();
    }
  }

  function onPresence(p) {
    presence = p;
    renderPeople(p);
    updateOpponentStatus(p);
    if (window.GomokuOnline.isActive()) renderPeople(p);
    if (!drawerOpen || drawerTab !== "people") {
      unreadPeople = Math.min(unreadPeople + 1, 99);
      updateBadges();
    }
  }

  function onCountdown(info) {
    lastDeadlineInfo = info;
    renderTurnTimer(info);
    checkBackgroundNotify(info);
  }

  function onRematchStart(msg) {
    lastResultShown = false;
    hide(els.dialog);
    hide(els.menu);
    els.ovRematch.hidden = true;
    window.GomokuOnline.hideResult(); // 關掉勝負 dialog
    systemNotice("新的一局開始！");
    showGameView();
    lastStateDTO = msg.state;
    window.GomokuOnline.enter({ mySeat: mySeat, spectate: mySeat === null, blackSeat: msg.blackSeat || 0, ruleset: msg.state.ruleset });
    window.GomokuOnline.applyState(msg.state);
  }

  function onGameOver(msg) {
    lastStateDTO = msg.state;
    window.GomokuOnline.applyState(msg.state);
    showFinishedResult(msg, msg.state);
    systemNotice("🏁 對局結束：" + (msg.reasonText || ""));
    systemNotice("歡迎留在聊天室繼續聊聊剛剛的戰局！");
    lastResultShown = true;
  }

  var wasDisconnected = false;

  function onConnectionChanged(up) {
    if (up) {
      hide(els.reconnect);
      if (wasDisconnected && inGameNow()) {
        systemNotice("已重新連線");
        wasDisconnected = false;
      }
    } else {
      if (inGameNow()) { show(els.reconnect); wasDisconnected = true; }
    }
  }

  function inGameNow() {
    return window.GomokuOnline.isActive() && els.layer.classList.contains("hidden");
  }

  function onRoomNotFound() {
    if (session) { session.dispose(); session = null; }
    currentRoomId = null;
    mySeat = null;
    window.GomokuOnline.leave();
    hide(els.hud);
    history.replaceState(null, "", "/");
    showScreen("home");
    openConfirm("找不到對局", "房間可能已結束或連結有誤，請建立新的對戰邀請。", "回到大廳", function () { }, "關閉");
  }

  function onRateLimited() {
    systemNotice("訊息太頻繁了，休息一下再聊");
  }

  function onConnectedElsewhere() {
    if (session) { session.dispose(); session = null; }
    leaveRoom();
    openConfirm("已在中斷連線", "你已在其他視窗加入此房間，此連線已中斷。", "知道了", null, "關閉");
  }

  // ---END-OF-SESSION-HANDLERS---

  /* ==================== 聊天 drawer（§6.2）==================== */

  function buildChips() {
    els.chatChips.textContent = "";
    Object.keys(P.CANNED_MESSAGES).forEach(function (id) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.dataset.canned = id;
      chip.textContent = P.CANNED_MESSAGES[id];
      chip.addEventListener("click", function () {
        if (session) session.sendCanned(id);
      });
      els.chatChips.appendChild(chip);
    });
  }

  function openDrawer() {
    drawerOpen = true;
    show(els.drawer);
    setDrawerTab("chat");
  }

  function closeDrawer() {
    drawerOpen = false;
    hide(els.drawer);
  }

  function setDrawerTab(tab) {
    drawerTab = tab;
    els.tabChat.classList.toggle("active", tab === "chat");
    els.tabPeople.classList.toggle("active", tab === "people");
    els.tabChat.setAttribute("aria-selected", tab === "chat" ? "true" : "false");
    els.tabPeople.setAttribute("aria-selected", tab === "people" ? "true" : "false");
    if (tab === "chat") {
      show(els.paneChat);
      hide(els.panePeople);
      unreadChat = 0;
      scrollChatBottom(true);
    } else {
      hide(els.paneChat);
      show(els.panePeople);
      unreadPeople = 0;
    }
    updateBadges();
  }

  function updateBadges() {
    var chatTotal = unreadChat;
    var peopleTotal = unreadPeople;
    function setBadge(el, n) {
      if (!el) return;
      if (n > 0) {
        el.textContent = String(Math.min(n, 99));
        show(el);
      } else hide(el);
    }
    setBadge(els.chatBadge, chatTotal);
    setBadge(els.chatBadgeTab, chatTotal);
    setBadge(els.peopleBadgeTab, peopleTotal);
  }

  function scrollChatBottom(force) {
    if (!force && !drawerOpen) return;
    els.chatList.scrollTop = els.chatList.scrollHeight;
  }

  // 系統公告：灰色置中，不進訊息歷史
  function systemNotice(text) {
    var div = document.createElement("div");
    div.className = "chat-system";
    div.textContent = text;
    els.chatList.appendChild(div);
    scrollChatBottom(false);
    trimChatList();
  }

  function appendChatMessage(msg, fromHistory) {
    if (!msg) return;
    var row = document.createElement("div");
    var mine = (msg.from === mySeat);
    row.className = "chat-row" + (mine ? " mine" : "") + (msg.kind === "canned" ? " canned" : "");

    var bubble = document.createElement("div");
    bubble.className = "chat-bubble";

    var nameLine = document.createElement("div");
    nameLine.className = "chat-name";
    var who = "";
    if (msg.from === 0 || msg.from === 1) {
      who = seatNameOf(msg.from) || (msg.from === 0 ? "玩家一" : "玩家二");
    } else {
      who = (msg.name || "觀眾") + "（觀眾）";
    }
    if (mine) who = (seatNameOf(mySeat) || "你") + "（你）";
    nameLine.textContent = who;
    if (!mine) bubble.appendChild(nameLine);

    var text = document.createElement("div");
    text.className = "chat-text";
    text.textContent = msg.text; // 一律 textContent，絕不 innerHTML（防 XSS）
    bubble.appendChild(text);

    row.appendChild(bubble);
    els.chatList.appendChild(row);
    trimChatList();
  }

  function trimChatList() {
    while (els.chatList.children.length > 200) {
      els.chatList.removeChild(els.chatList.firstChild);
    }
  }

  /* ==================== 人員名單（§7）==================== */

  var strokeCollator = (typeof Intl !== "undefined") ? new Intl.Collator("zh-Hant-TW-u-co-stroke") : null;

  function renderPeople(p) {
    if (!p) return;
    els.peoplePlayers.textContent = "";
    var order = p.seats.map(function (s, i) { return i; });
    // 陣營已定（對局中）則黑方排前面
    var blackSeat = lastStateDTO ? 0 : 0;
    if (lastStateDTO && session) blackSeat = session.blackSeat || 0;
    order.sort(function (a, b) { return (a === blackSeat ? 0 : 1) - (b === blackSeat ? 0 : 1); });
    order.forEach(function (i) {
      var seat = p.seats[i];
      var row = document.createElement("div");
      row.className = "person-row";

      var tag = document.createElement("span");
      tag.className = "seat-tag " + (i === blackSeat ? "black" : "white");
      tag.textContent = i === blackSeat ? "黑" : "白";
      row.appendChild(tag);

      var name = document.createElement("span");
      name.className = "person-name";
      var isWaiting = !p.seats[i] || p.seats[i].name === "等待中";
      name.textContent = isWaiting ? "等待中" : (seat ? seat.name : "等待中");
      row.appendChild(name);
      if (i === mySeat) {
        var you = document.createElement("span");
        you.className = "you-tag";
        you.textContent = "你";
        row.appendChild(you);
      }

      var status = document.createElement("span");
      status.className = "person-status";
      var st = personStatus(seat, isWaiting, i);
      status.textContent = st.text;
      status.classList.add(st.cls);
      row.appendChild(status);

      els.peoplePlayers.appendChild(row);
    });

    els.peopleSpectators.textContent = "";
    var list = (p.spectatorList || []).slice();
    if (strokeCollator) list.sort(function (a, b) { return strokeCollator.compare(a.name, b.name); });
    els.peopleSpecCount.textContent = "(" + list.length + ")";
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "people-empty";
      empty.textContent = "目前無觀戰人員";
      els.peopleSpectators.appendChild(empty);
    } else {
      list.forEach(function (spec) {
        var row = document.createElement("div");
        row.className = "person-row";
        var tag = document.createElement("span");
        tag.className = "seat-tag spec";
        tag.textContent = "觀";
        row.appendChild(tag);
        var name = document.createElement("span");
        name.className = "person-name";
        name.textContent = spec.name;
        row.appendChild(name);
        if (mySeat === null && isSelfSpectator(spec.name)) {
          var you = document.createElement("span");
          you.className = "you-tag";
          you.textContent = "你";
          row.appendChild(you);
        }
        var status = document.createElement("span");
        status.className = "person-status on";
        status.textContent = "觀戰中";
        row.appendChild(status);
        els.peopleSpectators.appendChild(row);
      });
    }
  }

  // 觀戰名單裡是否為自己（用自己輸入的暱稱比對）
  function isSelfSpectator(name) {
    var saved = window.OnlineTokens.loadName();
    return saved && name === saved;
  }

  function personStatus(seat, isWaiting, index) {
    if (isWaiting || !seat) return { text: "等待加入", cls: "wait" };
    if (seat.connected) return { text: "連線中", cls: "on" };
    if (seat.graceDeadlineAt) return { text: "斷線重連中", cls: "grace" };
    return { text: "離線", cls: "off" };
  }

  // ---END-OF-PEOPLE---

  /* ==================== 回合鐘 / 對手狀態 / 背景提醒 ==================== */

  function renderTurnTimer(info) {
    if (!info || window.GomokuOnline.isActive() === false) { hide(els.turnTimer); return; }
    var myTurn = info.seat === mySeat;
    var text = null;
    if (info.graceRemainingMs != null) {
      // 輪到的人斷線中：顯示寬限倒數
      text = (myTurn ? "斷線寬限 " : "對手重連中 ") + fmtClock(info.graceRemainingMs);
      els.turnTimer.className = "turn-timer grace";
    } else if (info.remainingMs != null) {
      text = (myTurn ? "你的思考時間 " : "對手思考時間 ") + fmtClock(info.remainingMs);
      els.turnTimer.className = "turn-timer" + (info.remainingMs < 10_000 ? " urgent" : "");
    } else if (info.pausedRemainingMs != null) {
      text = "等待對手重連…";
      els.turnTimer.className = "turn-timer grace";
    }
    if (text) {
      els.turnTimer.textContent = text;
      show(els.turnTimer);
    } else hide(els.turnTimer);
  }

  function updateOpponentStatus(p) {
    if (!p || mySeat === null || (p.seats[0] && p.seats[1] && p.seats[0].connected && p.seats[1].connected)) {
      hide(els.opponentStatus);
      opponentWasOffline = false;
      return;
    }
    var other = opponentSeat();
    var seat = p.seats[other];
    if (seat && !seat.connected) {
      if (!opponentWasOffline) {
        els.opponentStatus.textContent = "對手已斷線";
        show(els.opponentStatus);
        systemNotice("對手已斷線，等待重連…");
        opponentWasOffline = true;
      }
    } else if (seat && seat.connected && opponentWasOffline) {
      hide(els.opponentStatus);
      systemNotice("對手已重新連線");
      opponentWasOffline = false;
    } else {
      hide(els.opponentStatus);
    }
  }

  var opponentWasOffline = false;

  var wasDisconnected = false;

  // 輪到你而頁面在背景：標題閃爍 + 音效
  function checkBackgroundNotify(info) {
    var myTurn = info && info.seat === mySeat && mySeat !== null &&
      info.remainingMs != null && info.remainingMs > 0;
    if (myTurn && document.hidden && !yourTurnAlarm) {
      yourTurnAlarm = true;
      playBeep();
      startTitleFlash();
    } else if ((!myTurn || !document.hidden) && yourTurnAlarm) {
      stopTitleFlash();
      yourTurnAlarm = false;
    }
  }

  function startTitleFlash() {
    var on = false;
    stopTitleFlash();
    notifyTimer = setInterval(function () {
      document.title = (on = !on) ? "🔔 輪到你了！" : originalTitle;
    }, 1000);
  }

  function stopTitleFlash() {
    if (notifyTimer) { clearInterval(notifyTimer); notifyTimer = null; }
    document.title = originalTitle;
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) stopTitleFlash();
  });

  function playBeep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start();
      setTimeout(function () { osc.stop(); ctx.close(); }, 220);
    } catch (e) { /* 音效失敗不影響遊戲 */ }
  }

  // ---END-OF-NOTIFY---

  /* ==================== 主選單開合 ==================== */

  function openMenu() { syncMenuAvailability(); show(els.menu); }
  function closeMenu() { hide(els.menu); }

  /* ==================== QR code（動態載入，失敗即藏）==================== */

  var qrLoaded = false;
  function loadQr(url) {
    els.qr.hidden = true;
    function draw() {
      if (!window.QRCode || !window.QRCode.toCanvas) { els.qr.hidden = true; return; }
      try {
        window.QRCode.toCanvas(els.qr, url, {
          width: 168,
          margin: 2,
          color: { dark: "#201709", light: "#efe6d8" }
        }, function (err) {
          els.qr.hidden = !!err;
        });
      } catch (e) { els.qr.hidden = true; }
    }
    if (qrLoaded && window.QRCode) { draw(); return; }
    var script = document.createElement("script");
    script.src = "https://unpkg.com/qrcode@1.5.4/build/qrcode.min.js";
    script.onload = function () { qrLoaded = true; draw(); };
    script.onerror = function () { els.qr.hidden = true; };
    document.head.appendChild(script);
  }

  function copyInvite() {
    var url = els.inviteUrl.value;
    function done(ok) {
      toast(ok ? "已複製！" : "複製失敗，請長按連結");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(fallbackCopy(url)); });
    } else {
      done(fallbackCopy(url));
    }
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ==================== 主選單動作 ==================== */

  function syncMenuAvailability() {
    var seated = mySeat === 0 || mySeat === 1;
    var playing = window.GomokuOnline.isActive() && (lastStateDTO && !lastStateDTO.winner);
    els.menuDraw.disabled = !seated || !playing;
    els.menuAbort.disabled = !seated || !playing;
    els.menuResign.disabled = !seated || !playing;
  }

  function menuDraw() {
    closeMenu();
    openConfirm("提議和棋", "將徵詢對方同意後和棋結束本局。", "提出和棋", function () {
      if (session) session.offerDraw();
    });
  }

  function menuAbort() {
    closeMenu();
    var otherOnline = presence && presence.seats[opponentSeat()] && presence.seats[opponentSeat()].connected;
    if (!otherOnline) {
      openConfirm("結束對戰", "對手目前離線，對戰將直接結束（不計勝負）。", "直接結束", function () {
        if (session) session.requestAbort();
      });
    } else {
      openConfirm("結束對戰", "將徵詢對方同意後結束本局（不計勝負）。", "提出結束", function () {
        if (session) session.requestAbort();
      });
    }
  }

  function menuResign() {
    closeMenu();
    openConfirm("認輸", "確定要認輸嗎？對手將獲得本局勝利。", "認輸", function () {
      if (session) session.resign();
    });
  }

  function menuLeave() {
    closeMenu();
    openConfirm("離開房間", "離開後可用原邀請連結回來續戰（座位會保留）。", "離開", function () {
      leaveRoom();
    });
  }

  // ---END-OF-MENU---

  /* ==================== 事件接線 ==================== */

  function wire() {
    els.btnCreate.addEventListener("click", openSetupScreen);
    els.btnLocal.addEventListener("click", hideOnlineLayer);
    var entryOnline = document.getElementById("btn-entry-online");
    if (entryOnline) entryOnline.addEventListener("click", function () {
      if (!serverOk) { toast("線上對戰需要對戰伺服器，請改用單機模式"); return; }
      showScreen("home"); // showScreen 內部會收起入口首頁
    });
    els.btnCreateRoom.addEventListener("click", createRoom);
    els.btnSetupBack.addEventListener("click", function () { showScreen("home"); });
    els.btnJoinRoom.addEventListener("click", joinRoom);
    els.btnJoinBack.addEventListener("click", function () {
      history.replaceState(null, "", "/");
      showScreen("home");
    });
    els.btnCopy.addEventListener("click", copyInvite);
    els.btnWaitCancel.addEventListener("click", function () {
      if (session) { session.dispose(); session = null; }
      if (currentRoomId) window.OnlineTokens.clearToken(currentRoomId);
      leaveRoom();
    });

    // 確認 dialog
    els.odOk.addEventListener("click", function () {
      var fn = confirmHandler;
      closeConfirm();
      if (fn) fn();
    });
    els.odCancel.addEventListener("click", function () {
      var fn = confirmCancelHandler;
      closeConfirm();
      if (fn) fn(); // 協商婉拒也需回應對方
    });

    // 聊天 drawer
    els.btnChat.addEventListener("click", function () {
      if (drawerOpen) closeDrawer(); else openDrawer();
    });
    els.drawerClose.addEventListener("click", closeDrawer);
    els.tabChat.addEventListener("click", function () { setDrawerTab("chat"); });
    els.tabPeople.addEventListener("click", function () { setDrawerTab("people"); });
    els.chatForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = els.chatInput.value.trim();
      if (!text || !session) return;
      session.sendChat(text.slice(0, P.LIMITS.chatText));
      els.chatInput.value = "";
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        if (!els.dialog.classList.contains("hidden")) return; // modal 開著時 Esc 給 modal
        if (drawerOpen) closeDrawer();
      }
    });

    // 主選單
    els.btnMenu.addEventListener("click", openMenu);
    els.menuClose.addEventListener("click", closeMenu);
    els.menuCopy.addEventListener("click", function () {
      els.inviteUrl.value = location.origin + "/r/" + currentRoomId;
      copyInvite();
    });
    els.menuDraw.addEventListener("click", menuDraw);
    els.menuAbort.addEventListener("click", menuAbort);
    els.menuResign.addEventListener("click", menuResign);
    els.menuLeave.addEventListener("click", menuLeave);

    // 再來一局
    els.ovRematch.addEventListener("click", function () {
      els.ovRematch.hidden = true;
      window.GomokuOnline.hideResult();
      if (session) session.offerRematch();
    });

    // 落子意圖：server-authoritative，本地不裁決
    window.GomokuOnline.onPick(function (x, y) {
      if (!session) return;
      if (mySeat === null) { toast("觀戰模式無法進行此操作"); return; }
      if (lastStateDTO && lastStateDTO.winner) { toast("對局已結束"); return; }
      if (lastStateDTO && lastStateDTO.turn !== (mySeat === session.blackSeat ? 1 : 2)) {
        toast("還沒輪到你");
        return;
      }
      session.sendAction(x, y);
    });

    // 頁面關閉/切換時通知 lobby 停止
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && lobbySocket) return; // 保持連線，回來即可用
      if (!document.hidden && !lobbySocket && !els.layer.classList.contains("hidden") && !$("screen-home").classList.contains("hidden")) {
        startLobby();
      }
    });
  }

  /* ==================== boot ==================== */

  // 共用確認框 API（app.js 的「回主畫面」確認也用這組 dialog）
  window.GomokuConfirm = { open: openConfirm, close: closeConfirm };

  function boot() {
    buildChips();
    wire();
    probeHealth();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();