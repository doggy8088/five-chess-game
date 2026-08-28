# 五、後端 API 與管理後台設計（Backend API & Admin Console）

| 項目 | 內容 |
|---|---|
| 文件版本 | v1.0 |
| 撰寫日期 | 2026-08-29 |
| 產品名稱 | 五子棋 · Five Chess（Gomoku） |
| 程式版本 | v0.3.2（`package.json`，經 `server/config.js:38` 讀取並由 `/api/health` 公開） |
| 狀態 | 正式（Approved） |
| 資料來源 | `server/*.js` 全部原始碼、`shared/protocol.js`、`admin.html` / `admin.js` / `admin.css`、`server/tests/*`、`deploy.sh`、`Dockerfile`、`AGENTS.md` |
| 執行環境 | Node 22（`Dockerfile:2`）· Express 5.2.1 · ws 8.21.3 · @google-cloud/firestore 9.0.0（`package.json:24-28`） |
| 正式環境 | Cloud Run 服務 `gomoku`（專案 `vertex-ai-sprint` · 區域 `asia-east1`），網址 `https://gomoku-wpnna43hmq-de.a.run.app` |

---

## 5.1 後端模組地圖

單一 Node 程序同時服務：靜態檔 + REST API + WebSocket（`ws` noServer 手動 upgrade）。程式進入點 `server/index.js`，以 `createServer(opts)` 工廠函式組裝（`server/index.js:46`），`require.main === module` 時依 `FIRESTORE_ENABLED` 決定 store 後 `listen`（`server/index.js:581-614`）。

### 5.1.1 模組總表

| 檔案 | 行數 | 職責 | 主要匯出 | 相依 |
|---|---|---|---|---|
| `server/index.js` | 617 | HTTP routes、Express app、`/ws` upgrade、WS 訊息分派（`handleMessage`）、心跳、靜態檔與資產版本注入、後台管理 API 組裝 | `createServer(opts)` | config, protocol, guards, ids, room, store, rooms, auth, announcements, metrics, ip-monitor |
| `server/rooms.js` | 261 | `RoomManager`：房間快取、並發載入合併、write-through 每房寫入序列化、戰情中心名單（曝光規則）、50ms debounce lobby 推播、60s sweep、全站廣播 | `RoomManager`、`isLobbyListable`、`LOBBY_WAIT_VISIBILITY_MS`、`LOBBY_ENDED_RETENTION_MS` | protocol, config, ids, room |
| `server/room.js` | 677 | `Room` 房間本體：坐席認領、回合鐘三態、evaluate 惰性判定、重啟救援、和棋/提前結束/認輸/再來一局協商、聊天、presence 廣播、`toDoc`/`fromDoc` 序列化 | `Room`、`sanitizeName`、`sanitizeChatText` | game.js, protocol, config, ids |
| `server/guards.js` | 106 | 上行 WS 訊息白名單窄化（未知 `t` 一律丟棄回 `bad-message`；已知 `t` 逐欄位驗型與截斷） | `guardMessage`、`isPlainObject` | protocol（LIMITS） |
| `server/auth.js` | 176 | 後台登入：Google Identity Services ID token 驗簽（JWKS）＋ HMAC session cookie | `ADMIN_COOKIE`、`ADMIN_SESSION_TTL_MS`、`adminEmailsFromEnv`、`isAdminEmail`、`signAdminSession`、`verifyAdminSession`、`parseCookies`、`adminCookieHeader`、`clearAdminCookieHeader`、`randomSecret`、`verifyGoogleIdToken` | node:crypto（零外部相依） |
| `server/announcements.js` | 97 | 全站公告看板：同一時間僅一則生效公告、已讀回條、歷史 50 則、選配 persistence | `AnnouncementBoard`、`HISTORY_LIMIT` | node:crypto |
| `server/metrics.js` | 308 | 負載指標：分鐘桶（記憶體 72h）→ 小時點（90 天，可落 persistence）→ 日彙總（UTC+8 日界） | `Metrics`、`dayKey` | node:perf_hooks |
| `server/ip-monitor.js` | 362 | 依 IP 的流量追蹤、分鐘閥值告警、限時/永久封鎖、7 天小時桶歷史、選配 persistence | `IpMonitor`、`IP_BLOCK_DURATIONS`、`isIpBlockDuration`、`looksLikeIp`、閥值常數 | node:crypto |
| `server/store.js` | 37 | 可插拔 `RoomStore` 介面 + `InMemoryStore`（`npm run dev` 與測試用） | `InMemoryStore` | 無 |
| `server/firestore-store.js` | 72 | `FirestoreStore`：`rooms/{roomId}` 一房一文件（state/chat 存 JSON 字串、`expireAt` 存 Timestamp 供 TTL 刪除） | `FirestoreStore` | rooms.js（isLobbyListable）、@google-cloud/firestore（惰性 require） |
| `server/firestore-admin.js` | 123 | `FirestoreAdminStore`：後台資料持久化（公告/指標小時/IP 封鎖與流量/告警），dark-chess 同款移植 | `FirestoreAdminStore` | @google-cloud/firestore（惰性 require） |
| `server/config.js` | 38 | 伺服器常數（皆可環境變數覆寫）：PORT、回合鐘、心跳、聊天限速、sweep、TTL、Firestore 開關、版號 | 全部常數 | package.json（version） |
| `server/ids.js` | 27 | 房號 / 座位 token / 聊天訊息 id 產生器（crypto.randomBytes） | `newRoomId`、`newPlayerToken`、`newChatId`、`ROOM_ID_RE` | node:crypto |
| `shared/protocol.js` | 126 | client/server 共用訊息型別、常數、文案（UMD 雙用，零相依） | `Protocol`（ROOM_STATUS、LIMITS、CLIENT_TYPES、CANNED_MESSAGES、toStateDTO…） | 無 |

### 5.1.2 組裝關係（`createServer` 內，`server/index.js:46-579`）

```
createServer(opts)
 ├─ adminSecret / adminEmails     ← opts 或 env（ADMIN_SESSION_SECRET / ADMIN_EMAILS）(index.js:56-57)
 ├─ adminStore                    ← opts.adminStore（FIRESTORE_ENABLED 時由進入點注入 FirestoreAdminStore）(index.js:59-61)
 ├─ AnnouncementBoard(adminStore) → .init() 還原公告 (index.js:63-64)
 ├─ IpMonitor(adminStore) → .init() 還原封鎖/告警 → .start() (index.js:65-66)
 ├─ Express app（trust proxy=true）+ 全域中介層（指標 + IP 流量 + 封鎖 403）(index.js:69, 97-108)
 ├─ REST routes（§5.2）+ 靜態檔 (index.js:110-350)
 ├─ http server + ws(noServer) + upgrade handler（§5.3）(index.js:352-372)
 ├─ transport { send, close }（socketId → ws 的 JSON 送出/關閉）(index.js:379-388)
 ├─ managerHooks { onAnnouncementAck, activeAnnouncement } (index.js:395-401)
 ├─ RoomManager(store, transport, managerHooks) → startSweepTimer() (index.js:403-407)
 └─ Metrics({ gauge: manager.stats, persistence: adminStore }) → start() (index.js:410-423)
```

**注入點（測試用）**：`opts.store`、`opts.manager`、`opts.adminSecret`、`opts.adminEmails`、`opts.adminStore` 可全部注入，`createServer` 本身不建立網路連線，測試不依賴 Firestore（`server/index.js:46-61`；`server/tests/admin-routes.test.js:29-36`）。

### 5.1.3 依賴注入與啟動流程（`require.main` 分支，`server/index.js:581-614`）

1. `FIRESTORE_ENABLED`（預設開）→ 動態 `require` `FirestoreStore`（rooms 用）與 `FirestoreAdminStore`（後台資料用）；初始化失敗各別退回 InMemoryStore / 純記憶體，**服務不中斷**（`server/index.js:583-611`）。
2. `createServer({ store, adminStore })` → `server.listen(config.PORT)`（`server/index.js:610-613`）。
3. 本機開發：`npm run dev` = `FIRESTORE_ENABLED=0 node server/index.js`（`package.json:9`）。

---

## 5.2 REST API 完整規格

通用約定：

- **真實 IP 解析**：`app.set("trust proxy", true)`（`server/index.js:69`）；`clientIp()` 取 `X-Forwarded-For` 第一跳 → `req.ip` → socket 位址 → `"unknown"`（`server/index.js:38-44`）。
- **全域中介層**（所有路由之前，`server/index.js:97-108`）：`metrics.recordHttp()`（負載指標）→ `ipMonitor.recordHttp(ip)`（IP 流量）→ 封鎖檢查（豁免路徑 `/admin`、`/api/admin`、`/healthz`、`/api/health`，`IP_BLOCK_EXEMPT_RE` `server/index.js:32`）→ 封鎖中回 `403 {"error":"ip-blocked"}`。
- **JSON body 上限**：`express.json({ limit: "16kb" })`（`server/index.js:124`），超過即 413。
- **後台驗證**：`requireAdmin` 中介層（`server/index.js:139-148`）從 cookie `admin_session` 驗 HMAC session（§5.9），無效一律 `401 {"error":"unauthorized"}`。
- **速率限制**：REST 端點沒有 per-endpoint 限速器；防護靠（a）IP 流量監控與告警（§5.6）、（b）管理員手動封鎖、（c）body 16kb 上限、（d）WS 訊息經 guards 窄化（§5.5）。
- **快取策略**：HTML 一律 `Cache-Control: no-cache`（請求時注入資產版本，`server/index.js:110-112, 339-347`）；帶 `?v=` 的靜態資產 `public, max-age=31536000, immutable`（`?v=` 為檔案 sha1 前 8 碼，`server/index.js:76-92`）；無 `?v=` 的靜態資產 `max-age=3600`。

### 5.2.1 公開端點

| # | 方法與路徑 | 參數 | 成功回應 | 錯誤 | 驗證 | 來源 |
|---|---|---|---|---|---|---|
| 1 | `GET /` | — | `index.html`（`?v=__ASSET_VER__` 已注入內容雜湊） | — | 無 | `server/index.js:110-112` |
| 2 | `GET /api/healthz` | — | `200` 純文字 `"ok"` | — | 無（IP 封鎖豁免） | `server/index.js:113`（註：`/healthz` 被 Google Frontend 保留，故掛在 `/api/` 下） |
| 3 | `GET /api/health` | — | `{"ok":true,"version":"0.3.2"}`（`config.VERSION`） | — | 無（IP 封鎖豁免） | `server/index.js:114`、`server/config.js:38` |
| 4 | `GET /api/games` | — | `{"games":[GameSummary…]}`，上限 `LOBBY_HTTP_LIMIT=20` 筆，`updatedAt` 新→舊 | store 失敗時**回 200 空陣列**（`{"games":[]}`），不 5xx | 無 | `server/index.js:116-122`、`shared/protocol.js:96`、`server/rooms.js:186-210` |
| 5 | `POST /api/rooms` | body `{name?:string, ruleset?:string}`；`name` 截斷至 `LIMITS.joinName=24`；`ruleset` 經 `normalizeRuleset`（非法值退 `"standard"`） | `201 {"roomId":"abcdefgh23","playerToken":"<32hex>","ruleset":"standard"}` | （無參數驗證錯誤；一律可建立） | 無 | `server/index.js:297-308`、`shared/protocol.js:34-36`、`server/ids.js:13-21` |
| 6 | `GET /r/:roomId` | 路徑 roomId | `index.html`（SPA 殼，client 從路由解析房間） | — | 無 | `server/index.js:310-313` |
| 7 | `GET /online` | — | `index.html`（線上大廳 SPA 殼；深連結/重新整理用） | — | 無 | `server/index.js:315-318` |
| 8 | `GET /game` | — | `index.html`（本地遊戲 SPA 殼） | — | 無 | `server/index.js:320-323` |
| 9 | `GET /admin` | — | `admin.html`（後台殼，同樣注入資產版本） | 檔案不存在 → `404 {"error":"admin-ui-missing"}` | 無（登入在前端 GSI 完成） | `server/index.js:326-341` |
| 10 | 靜態檔 | — | `express.static(rootDir, { index:false })`；快取策略見上 | 404 | 無 | `server/index.js:339-350` |
| 11 | `WS /ws` | upgrade（§5.3） | 101 Switching Protocols | 非 `/ws` 路徑 → socket destroy；封鎖 IP → `HTTP/1.1 403` + destroy | 無 | `server/index.js:353-372` |

### 5.2.2 後台管理端點（皆掛 `requireAdmin`，除 12/13/15）

| # | 方法與路徑 | 參數 | 成功回應 | 錯誤碼 | 驗證 | 來源 |
|---|---|---|---|---|---|---|
| 12 | `GET /api/admin/config` | — | `{"clientId":"<GOOGLE_CLIENT_ID>"}`（未設定時 `clientId:null`） | — | 無（公開；登入按鈕用） | `server/index.js:150-153` |
| 13 | `POST /api/admin/google` | body `{"credential":"<Google ID token>"}` | `200 {"ok":true,"email":"…"}` + `Set-Cookie: admin_session=…; HttpOnly; Secure; SameSite=Lax; Max-Age=43200` | `503 google-not-configured`（未設 GOOGLE_CLIENT_ID）／`400 missing-credential`／`401 not-admin`（驗簽失敗或不在 allowlist）／`500 auth-failed`（例外） | 無 | `server/index.js:155-178` |
| 14 | `GET /api/admin/session` | — | `{"authenticated":bool,"email":string\|null}` | — | 無 | `server/index.js:180-183` |
| 15 | `POST /api/admin/logout` | — | `{"ok":true}` + 清 cookie（`Max-Age=0`） | — | 無 | `server/index.js:185-190`、`server/auth.js:158-160` |
| 16 | `POST /api/admin/announcements` | body `{"text":string}`；清洗：剝控制字元（<32 與 127）→ trim → 500 字 | `{"ok":true,"announcement":{id,text,at,reached,acks:0}}`；同時廣播到所有快取房間（玩家+觀眾）與所有大廳訂閱者；`reached = players + spectators + lobby 訂閱數` | `401`／`400 empty-text` | admin | `server/index.js:192-215` |
| 17 | `GET /api/admin/announcements` | — | `{"announcements":[{id,text,at,reached,acks}…]}`（新→舊，最多 50） | `401` | admin | `server/index.js:217-219`、`server/announcements.js:78-83` |
| 18 | `GET /api/admin/metrics/live` | — | `{version, players, spectators, lobby, roomsPlaying, roomsWaiting, lagMs, cpuPct, rssMb, heapMb, uptimeSec}` | `401` | admin | `server/index.js:221-224`、`server/metrics.js:231-241` |
| 19 | `GET /api/admin/metrics/series` | query `granularity=minute\|hour\|day`（預設 minute）、`from`、`to`（ms；`to` 預設 now、`from` 預設 to−1h） | `{"granularity","points":[MinuteBucket\|HourPoint\|DayPoint…]}` | `401`／`400 bad-granularity`／`500 metrics-failed` | admin | `server/index.js:226-251` |
| 20 | `GET /api/admin/ip-stats` | query `range=1h\|24h\|7d`（預設 24h；非法值**退回 24h 不報錯**） | `{"range","points":[{ip,http,wsMsg,connEvents,concurrent,firstSeen,lastSeen,blocked,blockExpiresAt}…]}`（依 http+wsMsg 排序取前 10） | `401` | admin | `server/index.js:32,253-258`、`server/ip-monitor.js:285-320` |
| 21 | `GET /api/admin/ip-alerts` | — | `{"alerts":[{id,ip,type,detail,at}…]（新→舊，上限 200）,"thresholds":{httpPerMin,wsPerMin,connPerMin,httpPerHour,retentionDays:7}}` | `401` | admin | `server/index.js:260-262`、`server/ip-monitor.js:322-336` |
| 22 | `GET /api/admin/ip-blocks` | — | `{"blocks":[{ip,blockedAt,expiresAt,blockedBy}…]}`（blockedAt 新→舊；已到期者順手刪除） | `401` | admin | `server/index.js:264-266`、`server/ip-monitor.js:352-367` |
| 23 | `POST /api/admin/ip-blocks` | body `{"ip":string,"duration":"5m\|30m\|1h\|6h\|24h\|7d\|permanent"}` | `{"ok":true,"block":{ip,blockedAt,expiresAt,blockedBy}}`；**立即以 close code 4003 踢掉該 IP 全部既有 WS 連線**（upgrade 檢查只擋新連線） | `401`／`400 bad-ip`（空、>45 字元、非 IPv4/IPv6）／`400 bad-duration` | admin | `server/index.js:268-290`、`server/ip-monitor.js:44-49,338-350` |
| 24 | `DELETE /api/admin/ip-blocks/:ip` | 路徑 ip（需 encodeURIComponent） | `{"ok":true,"removed":bool}`（重複刪除 `removed:false`） | `401` | admin | `server/index.js:292-295` |

### 5.2.3 回應資料結構（DTO）

**GameSummary**（戰情中心每一列，`server/rooms.js:135-181`）：

```json
{
  "roomId": "abcdefgh23",
  "status": "playing | waiting | finished",
  "createdAt": 1725000000000,
  "players": [ { "name": "阿黑", "color": "black" }, { "name": "阿白", "color": "white" } ],
  "blackCount": 12, "whiteCount": 11,
  "turnNumber": 23, "spectators": 1, "updatedAt": 1725000123456
}
```

- `players` 依 `blackSeat` 對映顏色；快取外（來自 store）的房間 `spectators` 恆為 0（`server/rooms.js:175`）。

**MinuteBucket**（`granularity=minute`，`server/metrics.js:143-179`）：

```json
{ "t": 1725000000000, "http": 120, "wsMsg": 640, "connPeak": 8, "connAvg": 5.2,
  "playersPeak": 4, "spectatorsPeak": 2, "lobbyPeak": 3,
  "roomsPlayingPeak": 2, "roomsWaitingPeak": 1,
  "lagP95": 4.5, "lagMax": 12.3, "cpuAvg": 18.2, "cpuPeak": 42.5,
  "rssPeak": 314572800, "heapPeak": 104857600 }
```

**HourPoint**（`granularity=hour`，`server/metrics.js:181-219`）：`{t, samples, http, wsMsg, connPeak, connSum, playersPeak, spectatorsPeak, lobbyPeak, roomsPlayingPeak, roomsWaitingPeak, lagP95Max, lagMax, cpuPeak, cpuSum, rssPeak, heapPeak}`（`connSum÷samples`=平均連線，前台圖表換算）。

**DayPoint**（`granularity=day`，`server/metrics.js:274-311`）：同 HourPoint 但以 `day`（`YYYY-MM-DD`，台北 UTC+8 日界）為鍵，加總 http/wsMsg/connSum/cpuSum、峰值取 max。

---

## 5.3 WebSocket API 規格

### 5.3.1 連線建立（upgrade，`server/index.js:353-372`）

| 項目 | 規格 |
|---|---|
| 端點 | `GET /ws`（upgrade）。查詢參數**不使用**——所有身分資訊都在 `join` 訊息內帶 `playerToken`/`name`/`spectate`（`server/index.js:508-526`） |
| 路徑檢查 | 非 `/ws` → `socket.destroy()`（`server/index.js:357-359`） |
| IP 封鎖 | 封鎖中的 IP 直接回 `HTTP/1.1 403 Forbidden` 並 destroy（`server/index.js:361-365`） |
| 連線身分 | `ws.ip` 記錄升級時的 client IP（封鎖時踢線用，`server/index.js:366-370`） |
| socketId | 連線事件時配發 `"s" + 遞增整數`（`server/index.js:376, 427-428`） |
| 連線當下封鎖競態 | upgrade 後才被封鎖 → 連線事件內立即 `close(4003, "ip-blocked")`（`server/index.js:436-438`） |
| 記錄 | `ipMonitor.recordWsConnect(ip)`／斷線時 `recordWsDisconnect(ip)`（`server/index.js:433, 461`） |

### 5.3.2 心跳（`server/index.js:565-574`、`server/config.js:18`）

每 `HEARTBEAT_MS=30s` 對所有 client `ping`；上一輪沒回 pong（`isAlive=false`）就 `terminate()`。原因：Cloud Run/代理會砍靜默連線。pong 事件重設 `isAlive`（`server/index.js:440`）。計時器 `.unref()` 不阻擋程序結束。

### 5.3.3 client → server 訊息（白名單，`shared/protocol.js:46-50`）

所有上行訊息先過 `guards.guardMessage()`（`server/guards.js:25-105`）：非純物件、未知 `t`、欄位驗型失敗 → 丟棄並回 `{t:"error", code:"bad-message"}`（`server/index.js:442-456`）。JSON 解析失敗同樣回 `bad-message`。處理函式擲錯時也回 `bad-message`（`server/index.js:451-454`）。

| 訊息 t | 欄位（guards 窄化後） | 說明 | server 端處理 | 來源 |
|---|---|---|---|---|
| `subscribeLobby` | （無） | 訂閱戰情中心推播 | 加入 `lobbySubscribers`；**先**補送當前生效公告（若有），再送一次當前 lobby 名單（`LOBBY_PUSH_LIMIT=50`） | `server/index.js:483-488`、`server/rooms.js:101-113` |
| `join` | `roomId`(必填,≤24)、`playerToken`(≤64,選)、`name`(≤24,選)、`spectate`(bool,選) | 進房/重連/換房。換房時先從舊房 disconnect；token 命中座位 → 認領（舊連線被踢）；無 token 且 seat 1 空且未 spectate → 遞補開打；否則觀眾。房間不存在回 `error room-not-found` | `server/index.js:508-526`、`server/room.js:153-197, 339-369` |
| `action` | `seq`(整數≥1)、`action:{x,y}`（整數） | 落子。規則驗證→套用→廣播 `actionApplied`（seq 只回動作者）。非輪到/觀戰/已結束/非法 → `invalid` | `server/index.js:528-534`、`server/room.js:372-437` |
| `chat` | `text`(≤500 原始) | 自由聊天；清洗控制字元+截 120 碼點；滑動窗口限速 | `server/index.js:536-542`、`server/room.js:558-576` |
| `canned` | `id`(≤32) | 快速訊息（24 句白名單）；未知 id **靜默丟棄**（不回錯） | `server/index.js:544-550`、`server/room.js:578-597`、`shared/protocol.js:64-90` |
| `drawOffer` | （無） | 提議和棋 → 廣播 `drawOffered` | `server/index.js:552`、`server/room.js:439-445` |
| `drawResponse` | `accept`(bool) | 同意 → `finish("draw-agreed")`；拒絕 → 廣播 `drawRejected`。觀眾不可參與 | `server/index.js:553`、`server/room.js:447-460` |
| `abortRequest` | （無） | 提前結束。**對手離線 → 直接 `finish("aborted")`**；在線 → 廣播 `abortOffered` | `server/index.js:554`、`server/room.js:462-472` |
| `abortResponse` | `accept`(bool) | 同意 → `finish("aborted")`；拒絕 → 廣播 `abortRejected` | `server/index.js:555`、`server/room.js:474-487` |
| `resign` | （無） | 認輸 → 立即 `finish("resign", 對手座位)` | `server/index.js:556`、`server/room.js:489-493` |
| `rematch` | （無） | 再來一局提議（僅 finished 房有效）→ 廣播 `rematchOffered` | `server/index.js:557`、`server/room.js:495-500` |
| `rematchResponse` | `accept`(bool) | 同意 → `startRematch()` 重洗換先；拒絕 → 廣播 `rematchRejected` | `server/index.js:558`、`server/room.js:502-533` |
| `announcementAck` | `id`(≤64，剝控制字元後不可空) | 公告已讀回條。房內記坐席名或觀眾名；僅在大廳的連線記為「🏠 大廳」 | `server/index.js:490-506`、`server/room.js` ackName 邏輯、`server/announcements.js:66-76` |

> 未知 `t` → `error bad-message`（`server/index.js:560-562`）。`seq` 機制：client 為每個 `action` 配遞增序號，`actionApplied` **只對動作者**附帶 `seq`，供 client 對帳確認（`server/room.js:402-411`；測試 `server/tests/room.test.js:97-110`）。

### 5.3.4 server → client 訊息（廣播視角）

| 訊息 | 欄位 | 觸發時機 | 收件者 | 來源 |
|---|---|---|---|---|
| `lobby` | `{t, games:[GameSummary]}` | subscribeLobby 當下；房間活動後 50ms debounce 統一推播 | 大廳訂閱者 | `server/rooms.js:115-133` |
| `announcement` | `{t, id, text, at}` | 後台發佈（全房 fan-out + lobby 訂閱者）；新 lobby 訂閱者先補送當前生效公告 | 全部連線 | `server/index.js:206-214`、`server/rooms.js:103-108` |
| `joined` | `{t, roomId, seat, roomStatus, blackSeat, state, deadline, chat(≤50), presence, gameOver?, playerToken?}` | join 成功（單發給本人；`playerToken` 僅坐席者附帶） | join 者 | `server/room.js:351-368` |
| `state` | `{t, roomStatus, blackSeat, state:StateDTO, deadline}` | seat 1 遞補開打（waiting→playing） | 全房 | `server/room.js:183-197` |
| `actionApplied` | `{t, by, action:{x,y}, state, deadline, seq?}` | 落子套用後（seq 僅回動作者） | 全房 | `server/room.js:402-411` |
| `deadline` | `{t, deadline:DeadlineDTO\|null}` | 回合鐘變動（開始/暫停/恢復） | 全房 | `server/room.js:614-617` |
| `presence` | `{t, presence:PresenceDTO}` | join/終局後 | 全房 | `server/room.js:619-621` |
| `chat` | `{t, msg:{id,from,kind,text,at,name?,cannedId?}}` | 聊天/canned 通過限速後 | 全房（含發話者） | `server/room.js:573, 596` |
| `invalid` | `{t, message, seq?, code?, warn?}` | 動作被拒（含規則引擎中文訊息、`forbidden-warn` 禁手警示碼） | 動作者 | `server/room.js:634-640` |
| `error` | `{t, code, message}` | `bad-message`／`room-not-found`／`connected-elsewhere`／`rate-limited` | 單一連線 | `shared/protocol.js:93`、`server/index.js:449,518,530`、`server/room.js:562` |
| `gameOver` | `{t, reason, reasonText, winnerIndex, state, deadline:null}` | `finish()` 任何終局 | 全房 | `server/room.js:536-556` |
| `drawOffered` / `drawRejected` | `{t, by}` | 和棋協商 | 全房 | `server/room.js:443, 458` |
| `abortOffered` / `abortRejected` | `{t, by}` | 提前結束協商 | 全房 | `server/room.js:470, 485` |
| `rematchOffered` / `rematchRejected` | `{t, by}` | 再來一局協商 | 全房 | `server/room.js:497, 510` |
| `rematchStart` | `{t, blackSeat, state, deadline}` | 再來一局開打（先手交換） | 全房 | `server/room.js:515-533` |

**StateDTO**（`shared/protocol.js:109-125`）：`{size:15, ruleset, board, moves, turn(1|2|null), winner(1|2|"draw"|null), winLine, moveNumber, blackForbiddenWarned, forbidden, forbiddenType}`——五子棋無隱藏資訊，完整公開盤面。

**DeadlineDTO**（`server/room.js:305-317`）：`{seat, at(deadline 時間戳\|null), pausedRemainingMs\|null, graceAt\|null, serverNow}`——client 一律以 `serverNow` 校時後本地倒數。

**PresenceDTO**（`server/room.js:319-336`）：`{seats:[{name, connected, graceDeadlineAt?}×2], spectators, spectatorList:[{name}…]}`；空位顯示 `"等待中"`；離線且輪到該席時附 `graceDeadlineAt`。

**終局 reason 對照表**（`shared/protocol.js:21-31`）：`five`／`forbidden`（黑棋禁手判負）／`board-full`／`draw-agreed`／`timeout`（行動鐘逾期）／`forfeit`（斷線逾時未回）／`resign`／`aborted`（提前結束不計勝負），`reasonText()` 提供中文文案。

### 5.3.5 連線生命週期與錯誤碼（`server/index.js:425-472`）

- `close`：從 sockets 移除 → 取消 lobby 訂閱 → IP 斷線記錄 → 若在房內呼叫 `room.disconnect()` 並 persist（`server/index.js:458-470`）。
- `error`：僅記 log，交由 close 接手（`server/index.js:471`）。
- **錯誤碼總表**（`shared/protocol.js:93`）：

| code | HTTP/WS 位置 | 意義 |
|---|---|---|
| `room-not-found` | WS `error`（或房內訊息找不到房） | 找不到對局（`server/index.js:518,530`） |
| `bad-message` | WS `error` / `invalid` | 訊息格式無效或處理失敗（`server/index.js:449,454,561`） |
| `connected-elsewhere` | WS `error` + `close(4000)` | 同 token 在其他視窗加入，舊連線被踢（`server/room.js:343-348`；測試 `server/tests/room.test.js:66-78`） |
| `rate-limited` | WS `error` | 聊天超過限速（`server/room.js:562,583`） |
| `ip-blocked` | HTTP 403（JSON）／WS close 4003 | 該 IP 已被封鎖（`server/index.js:103-106, 286, 437`） |
| `unauthorized` | HTTP 401 | 後台 API 未登入（`server/index.js:141-143`） |
| `connected-elsewhere` 的 close code | `4000` | 同上 |
| — | `4003` | IP 封鎖踢線專用碼（`server/index.js:286,437`） |

---

## 5.4 房間伺服器狀態機（server-authoritative）

### 5.4.1 狀態與轉移（`shared/protocol.js:18`、`server/room.js`）

```
        seat1 遞補 (_fillSeat1, room.js:183)
WAITING ───────────────────────────────► PLAYING ──finish()──► FINISHED
   ▲                                       │  ▲                   │
   │ create (room.js:32)                   │  └─ rematch 同意       │ rematch 同意
   └───────────────────────────────────────┴────────────────────────┘
                  (startRematch, room.js:515：重洗整盤、blackSeat 互換、
                   negotiation 清空、expireAt 重置為 now+STALE_TTL)
```

| 狀態 | 意義 | 進入 | 離開 |
|---|---|---|---|
| `waiting` | 只有建立者（seat 0，執黑） | `POST /api/rooms` | seat 1 遞補 → playing |
| `playing` | 對局中，回合鐘運作 | 遞補／rematch | 任何終局原因 → finished |
| `finished` | 已終局（含 `aborted` 不計勝負） | `finish(reason, winnerSeat)`（`room.js:536-556`） | rematch 同意 → playing；或被 sweep |

`finish()` 行為：狀態 → finished、`result={reason, winnerIndex}`、清空回合鐘與協商、`expireAt = now + FINISHED_TTL_MS(24h)`、廣播 `gameOver` + `presence` + lobby 活動通知。

**終局原因 → 判定**：

| reason | 觸發 | winnerIndex |
|---|---|---|
| `five` | 連五（`_reasonFromGame`，`room.js:414-421`） | 連五方座位 |
| `forbidden` | 連珠黑棋禁手**再犯**（首犯退回不判負） | 白方座位 |
| `board-full` | 棋盤下滿 | `null`（和棋） |
| `draw-agreed` | 雙方同意和棋（`room.js:449-453`） | `null` |
| `timeout` | 行動鐘逾期（evaluate，`room.js:280-283`） | 對手座位 |
| `forfeit` | 斷線寬限逾期（evaluate，`room.js:275-278`） | 對手座位 |
| `resign` | 認輸（`room.js:489-493`） | 對手座位 |
| `aborted` | 雙方同意提前結束，或提議時對手已離線（`room.js:462-472`） | `null` |

### 5.4.2 回合鐘三態與 deadline 惰性判定（§4 鐵則）

**資料結構**：`turn = { deadlineAt, pausedRemainingMs, graceDeadlineAt }`（`server/room.js:43, 105-107`）。**Cloud Run CPU throttling 下 setTimeout 不可靠，真相一律以時間戳惰性判定**（`server/config.js:2-3`）。

| 態 | 條件 | turn 欄位 | 恢復條件 |
|---|---|---|---|
| 行動鐘 | 輪到者**在線** | `deadlineAt = now + TURN_MS(60s)`，其餘 null | 逾期 → evaluate 判 `timeout` |
| 暫停 | 輪到者**離線** | `pausedRemainingMs = 剩餘`、`deadlineAt = null`、`graceDeadlineAt = now + GRACE_MS(90s)` | 寬限內以 token 重連 → `_resumeClock` 恢復 `deadlineAt = now + pausedRemainingMs`（`room.js:258-270`） |
| — | waiting / finished | 三欄全 null、`deadlineDTO()` 回 null（`room.js:305-317`；測試 `timers.test.js`） | — |

- **evaluate()**（`server/room.js:272-286`）：`graceDeadlineAt` 逾期 → `finish("forfeit")`；`deadlineAt` 逾期 → `finish("timeout")`。在**每則訊息處理前、每個協商動作前、disconnect 時、manager.stats() 時**都被呼叫（`server/room.js:340,373,440,448,463,474,490`、`server/rooms.js:217`）——不依賴任何 timer。
- **nudge timer**（`server/room.js:288-303`）：`setTimeout` 指到最近的 deadline +20ms 後呼叫 evaluate，僅為了「即時性」，`.unref()`，逾期判定的正確性不依賴它。
- **斷線處理**（`server/room.js:199-232`）：僅當**輪到者**斷線才暫停鐘＋開寬限窗並廣播 deadline；非輪到者斷線不影響。
- **重啟救援**（`_restartRescue`，`server/room.js:94-110`）：`fromDoc` 載入 playing 房時——(a) 原本在寬限 → 寬限重算 `now+GRACE`；(b) 行動鐘（即使已逾期）→ 轉暫停＋全新寬限窗，剩餘至少 10 秒。**停機期間過期的期限絕不溯及判負**（測試 `server/tests/timers.test.js:97-135`）。

### 5.4.3 坐席與重連規則（`server/room.js:153-197`）

1. **token 認領**：`join` 帶 `playerToken` 且符合 seat 0/1 → 直接認領（即使帶 `spectate` 也以坐席為準）。`playerToken` 是**唯一入場憑證**（32 hex，`server/ids.js:20-21`），建立者從 `POST /api/rooms` 取得、遞補者在 `joined` payload 取得。
2. **connected-elsewhere**：同 token 第二視窗加入 → 舊 socket 收 `error connected-elsewhere` 後被 `close(4000)`，座位轉移給新 socket（`server/room.js:343-348`）。
3. **遞補**：seat 1 空著、未指定 spectate、房間非 finished → 產生新 token 入座，waiting→playing 並啟動回合鐘、廣播 `state`。
4. **觀眾**：其餘（帶 `spectate:true`、房已滿、或已 finished）→ `spectators` Map（socketId→{name}）。
5. **斷線≠離開**：`disconnect()` 只清 socket 關聯並把 `connected=false`；座位與 token 保留，可隨時重連認領。

### 5.4.4 再來一局（rematch，`server/room.js:495-533`）

- 僅 finished 房可提議；雙方各提一次、對手回應；同意 → `startRematch()`：negotiation 全清、`blackSeat = 1 - blackSeat`（**先手交換**）、全新 `Game`、`result=null`、status→playing、`expireAt` 重置 7 天、啟動回合鐘、廣播 `rematchStart`。
- 落子會清空進行中的和棋/提前結束提議（`room.js:389-390`；測試 `room.test.js:231-236`）。

### 5.4.5 聊天（`server/room.js:558-618`）

- 文字訊息：剝控制字元（`[\u0000-\u001f\u007f]`）→ trim → 最多 120 碼點（emoji 不切半，`sanitizeChatText` `room.js:17-21`）；空訊息丟棄。
- 玩家訊息 `from = 0|1`（座位署名）；觀眾 `from = "spectator"` 帶 `name`。
- `canned`：24 句白名單（id 即白名單，`shared/protocol.js:64-90`），未知 id 靜默丟棄。
- 歷史：記憶體保留最後 50 則（`LIMITS.chatHistory`），`joined` payload 補發尾巴供重連補看。
- 限速：見 §5.5。

### 5.4.6 RoomManager 層（`server/rooms.js`）

| 機制 | 規格 | 來源 |
|---|---|---|
| 快取 | `Map<roomId, Room>`；`get()` 先查快取 | `server/rooms.js:38, 61-85` |
| 並發載入合併 | `inFlight` Map 合併同 roomId 的並發 load，**避免重啟後兩人同時 join 造出兩個分岔 Room**（測試 `store.test.js:104-117`） | `server/rooms.js:65-85` |
| write-through 持久化 | 每次訊息處理後 `persist()`；`writeChains` 每房寫入序列化（慢寫不會被後寫超車）；寫入失敗僅記 log 不斷鏈 | `server/rooms.js:87-98` |
| 房號檢查 | `ids.ROOM_ID_RE`（`/^[a-z2-9]{10}$/`）不符直接回 null，不打 store | `server/rooms.js:62`、`server/ids.js:11` |
| lobby 曝光規則 | playing 一律可列（但**未坐滿不上板**）；waiting 建立滿 30 秒（`LOBBY_WAIT_VISIBILITY_MS`）才曝光；finished 自終局（updatedAt）起 5 分鐘內保留（`LOBBY_ENDED_RETENTION_MS`） | `server/rooms.js:12-28, 186-210`；測試 `store.test.js:41-77` |
| lobby 名單組成 | 快取房 + `store.listActive(200)` 合併去重（Firestore 端僅查 `playing|finished`，**waiting 房只存在於快取**），updatedAt 新→舊，截 limit | `server/rooms.js:186-210`、`server/firestore-store.js:32-50` |
| sweep | 每 `ROOM_SWEEP_MS=60s`：`expireAt` 已過 → dispose＋刪 store 文件；finished 且無人連線 → 僅逐出快取（store 留到 TTL） | `server/rooms.js:232-255`；測試 `store.test.js:118-142` |

---

## 5.5 速率限制與輸入防護

### 5.5.1 WS 上行防護（guards.js）

| 防護 | 規格 | 來源 |
|---|---|---|
| 白名單 | 13 種 `t`（CLIENT_TYPES）；未知 `t`、非純物件、無字串 `t` → null（丟棄+`bad-message`） | `shared/protocol.js:46-50`、`server/guards.js:25-105` |
| 欄位截斷 | `roomId≤24`、`playerToken≤64`、`joinName≤24`、`chatRaw≤500`、`cannedId≤32`、`announcementAck≤64`（`LIMITS`，`shared/protocol.js:53-57`） | `server/guards.js:35-99` |
| 型別窄化 | `action.seq` 須整數 ≥1；`action.x/y` 須整數；回應類 `accept` 須 boolean；缺欄位即丟棄 | `server/guards.js:52-94` |
| 規則合法性 | guards 不驗盤面規則——**server 套用前經 `game.validateMove` 再驗一次**（server-authoritative，`server/room.js:378-387`） | `server/guards.js:2-3`、`server/room.js:372-387` |

### 5.5.2 聊天限速（per-socket 滑動窗口，`server/room.js:599-611`）

| 參數 | 預設 | 規則 |
|---|---|---|
| `CHAT_BURST` | 5 | `CHAT_WINDOW_MS` 窗口內最多 5 則 |
| `CHAT_WINDOW_MS` | 10,000ms | 滑動窗口 |
| `CHAT_MIN_GAP_MS` | 600 | 相鄰兩則最小間隔 600ms |
| 超限反應 | — | 回發話者 `{t:"error", code:"rate-limited", message:"訊息太頻繁了，休息一下再聊"}`，訊息**不進歷史**（測試 `chat.test.js:47-72, 92-98`） |

### 5.5.3 REST 防護

| 層 | 規格 | 來源 |
|---|---|---|
| body 上限 | `express.json({limit:"16kb"})` | `server/index.js:124` |
| IP 流量記錄 | 所有請求經全域中介層記入 ip-monitor（分鐘計數→閥值告警） | `server/index.js:97-108` |
| IP 封鎖 | 封鎖中的 IP → 403（健康檢查與後台豁免） | `server/index.js:32, 103-106` |
| 公告內容 | 剝控制字元→trim→500 碼點；空內容 400 | `server/index.js:194-201` |
| IP 參數 | `looksLikeIp`（IPv4/IPv6 寬鬆檢查）＋時長白名單 | `server/ip-monitor.js:44-49, 38-42` |
| 後台 session | HMAC 簽章 cookie、`timingSafeEqual` 常數時間比較 | `server/auth.js:118-133` |

---

## 5.6 IP 監控與告警（ip-monitor.js）

### 5.6.1 資料收集

| 項目 | 規格 | 來源 |
|---|---|---|
| 記錄維度 | 每 IP：HTTP 請求數、WS 訊息數、WS 連線事件數、目前並連數（`concurrent` Map） | `server/ip-monitor.js:104-151` |
| 分鐘桶 | `currentMinute {t, http, wsMsg, conns}`；跨分鐘時收尾（先告警再摺入小時桶） | `server/ip-monitor.js:104-127` |
| 小時桶 | 每小時 `{http, wsMsg, connEvents}`，保留 7 天（`IP_RETENTION_MS`） | `server/ip-monitor.js:155-166` |
| 記憶體上限 | 最多追蹤 5000 IP（`MAX_TRACKED_IPS`）；超過或逾 7 天未活動即 prune | `server/ip-monitor.js:52-53, 184-196` |
| 週期彙整 | `collect()` 每 60s：收尾跨分鐘桶、prune、把最近兩小時的桶持久化（5 分鐘節流） | `server/ip-monitor.js:168-232` |

### 5.6.2 告警閥值（環境變數可調，`server/ip-monitor.js:23-26`）

| 環境變數 | 預設 | 告警 type | 中文詳情 |
|---|---|---|---|
| `IP_ALERT_HTTP_PER_MIN` | 120 | `http-flood` | 單分鐘 HTTP 請求 N 次（閥值 120） |
| `IP_ALERT_WS_PER_MIN` | 600 | `ws-flood` | 單分鐘 WS 訊息 N 則（閥值 600） |
| `IP_ALERT_CONN_PER_MIN` | 10 | `conn-storm` | 單分鐘建立 N 條 WS 連線（閥值 10） |
| `IP_ALERT_HTTP_PER_HOUR` | 2000 | `http-hourly` | 單小時 HTTP 請求 N 次（閥值 2000） |

- 超過閥值（**嚴格大於**）即告警；同一 IP + 同類型 **5 分鐘內去重**只記一筆（`server/ip-monitor.js:198-232`；測試 `ip-monitor.test.js:29-70`）。
- 告警歷史上限 200 筆（`ALERT_HISTORY_LIMIT`，`server/ip-monitor.js:52`）。
- **通知管道：無外部 Webhook**——告警存在記憶體 + Firestore（`ip_alerts` collection），由管理後台「⚠️ 即時異常警示」面板輪詢 `/api/admin/ip-alerts` 顯示（§5.9），屬「人類判斷濫用」設計（`server/ip-monitor.js:2-3`）。

### 5.6.3 封鎖

| 項目 | 規格 | 來源 |
|---|---|---|
| 時長 | `5m / 30m / 1h / 6h / 24h / 7d / permanent`（permanent 以 `expiresAt:null` 表示） | `server/ip-monitor.js:29-42` |
| 生效點 | (1) HTTP：全域中介層 403（後台/健康檢查豁免）；(2) WS 升級：403 拒絕；(3) 既有 WS：封鎖當下立即 `close(4003)`；(4) 升級後才被封鎖的競態：連線事件內補 close | `server/index.js:97-108, 361-364, 280-288, 436-438` |
| 到期自動解除 | `isBlocked()`/`listBlocks()`/`prune()` 惰性檢查到期即刪（含 persistence） | `server/ip-monitor.js:338-367` |
| 持久化 | `ip_blocks` collection（文件 id = IP），重啟 `init()` 還原、丟棄已過期者 | `server/ip-monitor.js:69-87`、`server/firestore-admin.js:60-79` |

### 5.6.4 管理後台顯示

後台 IP 面板（`admin.js:459-626`）：Top-10 流量表（HTTP/WS/連線/目前並連/最近活動/狀態 pill「封鎖中（X 後解除）」）、每列「封鎖/解封」按鈕、手動封鎖輸入框、警示清單（type 中文映射：`http-flood`→HTTP 洪水、`ws-flood`→WS 訊息洪水、`conn-storm`→連線風暴、`http-hourly`→HTTP 時流量異常）、封鎖名單（含封鎖人 `blockedBy`）。

---

## 5.7 指標系統（metrics.js）

### 5.7.1 三層彙總

| 層 | 儲存 | 保留 | 來源 |
|---|---|---|---|
| 分鐘桶 | 記憶體 `Map` | 72 小時 | `server/metrics.js:19` |
| 小時點 | 記憶體 90 天 + Firestore `metrics_hours`（選配 persistence） | 90 天 | `server/metrics.js:20, 181-224` |
| 日彙總 | 查詢時由小時點即時聚合 | — | `server/metrics.js:274-318` |

### 5.7.2 取樣與收集

- **取樣器**：每 5 秒 `sample()`——取 gauge（由 RoomManager.stats 提供：players/spectators/lobby/roomsPlaying/roomsWaiting）、`process.memoryUsage()`（rssPeak/heapPeak）、CPU 使用率（兩次取樣間 CPU 時間÷真實時間，單 vCPU 為 100%）、event-loop lag（`perf_hooks.monitorEventLoopDelay`，取 mean，重置）。
- **收集器**：每 60 秒 `collect()`——關閉分鐘桶（算峰值/平均/p95）、寫入 minutes、`_rollupHour()` 摺入小時點並在內容有變時寫 persistence、清 72h 前的桶；進行中的小時以 5 分鐘節流 upsert，讓儀表板保持新鮮。
- **日界**：台北 UTC+8（`dayKey()` `server/metrics.js:32-34`；測試 `metrics.test.js:79-110`）。

### 5.7.3 暴露與呈現

| 指標 | 來源 | 後台呈現 |
|---|---|---|
| 即時 `live()` | gauge + lagMs + cpuPct + rssMb + heapMb + uptimeSec | 8 張即時卡（含 ▲▼ 10 秒趨勢）＋版號/運行時間 |
| `seriesMinute` | 分鐘桶 | 「每分鐘負載」折線：連線峰值、進行戰局、WS 訊息/分、HTTP 請求/分、CPU%（右軸 y2）、lag p95（右軸 y1） |
| `seriesHour` | 記憶體 ∪ Firestore（取 samples 多者） | 「每小時報表」：同上＋平均連線，可選日期（今天/昨天/上週，台北時區） |
| `seriesDay` | 小時點聚合（UTC+8 日界） | 「每日報表」：7/14/30/90 天 |

Chart.js（`assets/vendor/chart.umd.min.js`，UMD 全元件預註冊）雙 Y 軸折線圖；已有 instance 原地 update 不重建（`admin.js:328-457`）。

---

## 5.8 公告系統（announcements.js）

| 項目 | 規格 | 來源 |
|---|---|---|
| 資料結構 | `AnnouncementRecord { id:uuid, text, at, reached, acks:Set<名稱> }`；對外 view 的 `acks` 為已讀人數 | `server/announcements.js:43-83` |
| 生效模型 | **同一時間僅一則生效公告**；重新發佈即取代（舊公告留歷史、仍可累積已讀） | `server/announcements.js:43-56` |
| 內容清洗 | 剝控制字元（<32 與 127）→ trim → 500 碼點（`Array.from` 以碼點計，emoji 不切半） | `server/announcements.js:15-18`、`server/index.js:194-201` |
| 歷史 | 最多 50 則（`HISTORY_LIMIT`），最舊先擠掉 | `server/announcements.js:11, 51-52` |
| 觸及人數 | `reached = players + spectators + lobbySubscribers`（發佈當下統計） | `server/index.js:205-206` |
| 廣播 | fan-out 到快取中每個房間（玩家+觀眾）＋每個大廳訂閱者；訊息 `{t:"announcement", id, text, at}` | `server/index.js:208-214`、`server/rooms.js:226-228` |
| 已讀回條 | client 送 `{t:"announcementAck", id}`；房內記坐席名或觀眾名、僅大廳記「🏠 大廳」；同名只算一次；未知 id/空名忽略 | `server/index.js:490-506`、`server/announcements.js:66-76` |
| 新訂閱補送 | `subscribeLobby` 時**先**送當前生效公告再送 lobby 名單（順序有測試保證） | `server/rooms.js:101-113`；測試 `admin-routes.test.js:241-247` |
| 持久化 | Firestore `announcements`（文件 id=公告 uuid，`acks` 存字串陣列）；`init()` 重啟還原最近 50 則、`activeId` 取最新一筆；**persistence 掛掉不影響公告功能**（fire-and-forget） | `server/firestore-admin.js:23-47`、`server/announcements.js:29-41, 85-96` |
| 前台顯示 | client 端以彈窗呈現，玩家必須點「我知道了」才關閉並送出 ack（前台章節詳述） | `admin.js` 提示文字、`shared/protocol.js:58-61` |

---

## 5.9 管理後台設計（admin.html / admin.js / admin.css）

### 5.9.1 Google OAuth 登入流程

| 步驟 | 說明 | 來源 |
|---|---|---|
| 1. 取得 client id | 後台載入即 `GET /api/admin/config`；未設定 `GOOGLE_CLIENT_ID` → 顯示設定指引文案，不渲染登入鈕 | `admin.js:129-152`、`server/index.js:150-153` |
| 2. 載入 GSI | 動態插入 `https://accounts.google.com/gsi/client`，`google.accounts.id.initialize({client_id, callback})` + `renderButton`（filled_black / zh-TW） | `admin.js:115-152` |
| 3. 前端取 credential | Google Identity Services 回 ID token（JWT） | `admin.js:139-142` |
| 4. 伺服器驗證 | `POST /api/admin/google`：`verifyGoogleIdToken` 逐項檢查——三段式 JWT、`alg=RS256`+`kid`、以 Google 公開 JWKS 驗簽（快取 1 小時，`https://www.googleapis.com/oauth2/v3/certs`）、`exp` 未過期、`iss=accounts.google.com`（或 https 形式）、`aud=GOOGLE_CLIENT_ID`、`email_verified===true` | `server/index.js:155-178`、`server/auth.js:43-110` |
| 5. allowlist | `ADMIN_EMAILS`（逗號分隔、trim、不分大小寫去重；未設定預設 `doggy.huang@gmail.com`）比對 | `server/auth.js:15-29` |
| 6. 簽發 session | `signAdminSession`：`base64url({email, exp})` + `.` + HMAC-SHA256 mac（`ADMIN_SESSION_SECRET`）；TTL 12 小時；Set-Cookie `admin_session=…; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200` | `server/auth.js:112-160` |
| 7. 之後的請求 | `requireAdmin` 從 cookie 驗 session（`timingSafeEqual` 常數時間比較）＋再驗 email 仍在 allowlist → `res.locals.adminEmail` | `server/index.js:130-148`、`server/auth.js:118-133` |
| 8. 登出 | `POST /api/admin/logout` 清 cookie（Max-Age=0） | `admin.js:634-642` |

**重啟失效**：`ADMIN_SESSION_SECRET` 未設定時每次啟動 `crypto.randomBytes(32)` 隨機產生（`server/index.js:56`、`server/auth.js:162-164`）——**重啟即全員登出**（對小後台可接受，`server/auth.js:6-8`）。`deploy.sh` 會在未設定時沿用正式機現值避免此問題（§5.11）。

**後台 API 權限控管**：全部 `/api/admin/*`（除 config/session/logout）經 `requireAdmin`；無效/偽造 cookie → 401（測試 `admin-routes.test.js:88-102`）。session 同時驗 HMAC 與 email 仍在 allowlist（`server/index.js:131-136`）。

### 5.9.2 後台頁面功能逐一（`admin.html:24-140`、`admin.js`）

| 區塊 | 功能 | 資料來源 API | 來源 |
|---|---|---|---|
| 頁首 | 版號 + 運行時間（`伺服器版本 vX.Y.Z · 運行 N 小時 M 分`）、管理員 email（**CSS blur 遮蔽，hover/按住才顯示**）、登出、回前台 | `/api/admin/metrics/live` | `admin.html:12-22`、`admin.js:211-216`、`admin.css:79-92` |
| 登入頁 | Google 登入鈕、GOOGLE_CLIENT_ID 未設定指引、錯誤提示 | `/api/admin/config`、`POST /api/admin/google` | `admin.html:26-33`、`admin.js:115-165` |
| 即時指標卡 | 8 張卡：連線玩家／觀戰人數／大廳連線／進行戰局／等待房間（各含 ▲▼ 與 10 秒前比較、依人數的趣味狀態文案）、CPU 使用率、Event-loop 延遲、記憶體 RSS（含 Heap） | `/api/admin/metrics/live` | `admin.js:167-273` |
| 📢 伺服器公告 | textarea（maxlength 500）發送 + 歷史清單（`已讀 N/M` 追蹤） | `POST/GET /api/admin/announcements` | `admin.html:36-48`、`admin.js:275-326` |
| 每分鐘負載圖 | 範圍 60 分/6 小時/24 小時/72 小時；折線：連線峰值、進行戰局、WS 訊息/分、HTTP/分、CPU%、lag p95 | `/api/admin/metrics/series?granularity=minute` | `admin.html:50-58`、`admin.js:406-421` |
| 每小時報表 | 日期選擇（台北時區）＋今天/昨天/上週快捷 | `?granularity=hour` | `admin.html:60-70`、`admin.js:423-439` |
| 每日報表 | 7/14/30/90 天 | `?granularity=day` | `admin.html:72-82`、`admin.js:441-457` |
| 🛡️ IP 監控與封鎖 | 閥值說明列、Top 流量表（1h/24h/7d）、每列封鎖/解封、封鎖時長選單（5m→permanent）、手動封鎖 IP 輸入、⚠️ 即時異常警示、🔒 目前封鎖名單 | `/api/admin/ip-stats`、`ip-alerts`、`ip-blocks`、`POST/DELETE ip-blocks` | `admin.html:84-138`、`admin.js:459-626` |
| 頁尾 | 版號（登入前即由 `/api/health` 帶入） | `/api/health` | `admin.html:141-143`、`admin.js:630-633` |
| 自動刷新 | 每 10 秒輪詢全部面板；**分頁背景時暫停**、回前景立即補刷（`visibilitychange`） | 全部 | `admin.js:19, 96-101, 660-662` |

**戰情中心（lobby）注意**：後台即時卡的房間統計來自 `manager.stats()`（快取內房間，統計前先 `evaluate()` 惰性結算）；後台本身**沒有**房間列表管理介面（房間管理 = 觀察 lobby 名單 + IP 封鎖），這是現況範圍。

### 5.9.3 視覺設計（admin.css，瀏覽摘要）

純 CSS 無預處理器；深色系色票沿用前台 `styles.css` 的 `:root`（`--admin-bg:#0b1020`、`--admin-accent:#54d1ff`、`--admin-accent-warm:#ff7a59` 等），類名與暗棋管理後台一致方便對照維護（`admin.css:1-17`）；radial-gradient 背景、卡片圓角、IP 表列封鎖中以 `blocked-row` 標紅、狀態 pill（`ip-status-pill ok/blocked`）（`admin.css:31-42, 300+`）。

---

## 5.10 資料儲存

### 5.10.1 RoomDoc schema（`server/store.js:4-12`、`server/room.js:112-136`）

一房一份文件，重啟可完整重建：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `version` | number | 恆為 1（`FirestoreStore.listActive` 過濾 `version!==1`） |
| `roomId` | string | 10 碼房號 |
| `status` | string | `waiting\|playing\|finished` |
| `ruleset` / `size` | string / number | 規則集 / 15 |
| `blackSeat` | 0\|1 | 黑方座位（rematch 互換） |
| `seats` | `[{token,name,connected?}\|null, …]` | 座位；token 為入場憑證 |
| `stateJson` | object（Firestore 內為 **JSON 字串**） | `{size, ruleset, moves, blackForbiddenWarned}`——只存著法，重建用 `Game.fromMoves` |
| `turn` | `{deadlineAt, pausedRemainingMs, graceDeadlineAt}` | 回合鐘三態（時間戳） |
| `negotiation`（Firestore 內 `negotiationJson` 字串） | `{draw, abort, rematch}` | 協商狀態 |
| `chatJson` | array（Firestore 內為 **JSON 字串**） | 聊天歷史最後 50 則 |
| `result` | `{reason, winnerIndex}\|null` | 終局結果 |
| `createdAt` / `updatedAt` | number(ms) | 時間戳 |
| `expireAt` | number（Firestore 內 **Timestamp**） | TTL 欄位 |

### 5.10.2 TTL 規則（`server/config.js:29-30`、`server/room.js:50, 542, 522`）

| 狀態 | expireAt | 說明 |
|---|---|---|
| finished | 終局時間 + `FINISHED_TTL_MS`（**24 小時**） | 終局房 24h 後由 Firestore TTL 自動刪 |
| waiting/playing | 最後更新 + `STALE_TTL_MS`（**7 天**）；rematch 時重置 | 未結束房 7 天無活動即刪 |

Firestore TTL policy：`gcloud firestore fields ttls update expireAt --collection-group=rooms --enable-ttl`（`server/firestore-store.js:5`；`deploy.sh:53-57` 部署時自動執行，失敗不擋部署）。

### 5.10.3 FirestoreStore 對照（`server/firestore-store.js`）

- 路徑 `rooms/{roomId}`（collection 名可由 `FIRESTORE_COLLECTION` 覆寫）。
- `stateJson`/`negotiation`/`chatJson` 在 Firestore 以 **JSON 字串**儲存（Firestore 不收 undefined，optional 欄位會炸，`firestore-store.js:2-3, 52-62`）；`expireAt` 轉 `Date`（Timestamp）。
- `listActive`：`status in [playing, finished]` 單一欄位查詢（**不需複合索引**）、limit 200、記憶體內排序與曝光過濾（waiting 房不從 store 撈——只存在快取）。
- Firestore client 惰性 require（測試不觸網）。

### 5.10.4 InMemoryStore 對照（`server/store.js:14-36`）

`Map` 深拷貝存取；`listActive` 只列 `playing`、updatedAt 新→舊（`finished` 保留期曝光由 manager 層的 `isLobbyListable` 處理）。`FIRESTORE_ENABLED=0`（本機 dev）時使用。

### 5.10.5 後台資料 collections（`server/firestore-admin.js:14-18`）

| Collection | 文件 id | 內容 | 寫入者 |
|---|---|---|---|
| `announcements` | 公告 uuid | `{id, text, at, reached, acks:[名稱…]}` | AnnouncementBoard |
| `metrics_hours` | ISO 時間到小時（如 `2026-08-29T04`，冪等覆寫） | HourPoint | Metrics |
| `ip_hours` | `ip_YYYY-MM-DDTHH` | `{ip, t, http, wsMsg, connEvents}` | IpMonitor |
| `ip_blocks` | ip | `{ip, blockedAt, expiresAt, blockedBy}` | IpMonitor |
| `ip_alerts` | 告警 uuid | `{id, ip, type, detail, at}` | IpMonitor |

過期清理：`deleteIpDataOlderThan(7 天前)` 分批刪（單批 300）`ip_hours` 與 `ip_alerts`（`server/firestore-admin.js:90-123`）。

### 5.10.6 ids.js 房間 id 生成（`server/ids.js`）

| 項目 | 規格 |
|---|---|
| 房號 | 10 碼、28 個無歧義字元（22 個小寫字母去 `i/l/o` + 數字 `2-6,9`）→ `ROOM_ID_RE=/^[a-z2-9]{10}$/`。**不可猜——邀請連結是唯一入場憑證** |
| playerToken | `crypto.randomBytes(16).toString("hex")`（32 hex） |
| chatId | `crypto.randomBytes(8).toString("hex")`（16 hex） |

---

## 5.11 部署與環境

### 5.11.1 deploy.sh 全流程（`deploy.sh`）

| 步驟 | 內容 | 來源 |
|---|---|---|
| 參數 | `PROJECT_ID=vertex-ai-sprint`、`REGION=asia-east1`、`SERVICE=gomoku`（可 env 覆寫） | `deploy.sh:6-9` |
| 後台 env 帶入 | `GOOGLE_CLIENT_ID` / `ADMIN_SESSION_SECRET` 未在本機設定時，**從正式機 `gcloud run services describe` 讀回現值沿用**——避免每次部署把 secret 清空導致全員登出；`ADMIN_EMAILS` 預設 `doggy.huang@gmail.com` | `deploy.sh:11-33` |
| 警告 | 兩者仍缺時印警告（GOOGLE_CLIENT_ID 缺 → 無法登入 /admin；SECRET 缺 → 重啟全員登出） | `deploy.sh:35-40` |
| 啟用 API | run / firestore / cloudbuild | `deploy.sh:42-43` |
| 部署 | `gcloud run deploy --source .`（Cloud Build）＋ **`--session-affinity`（WS 綁定同一 instance 的關鍵）**、`--timeout 3600`、`--min-instances 0`、`--max-instances 1`、`--memory 512Mi`、`--cpu 1`、`--allow-unauthenticated`、`--set-env-vars`（FIRESTORE_ENABLED=1, FIRESTORE_COLLECTION=rooms, NODE_ENV=production, 後台三變數） | `deploy.sh:45-56` |
| TTL | `gcloud firestore fields ttls update expireAt --collection-group=rooms --enable-ttl`（失敗不擋，可能已啟用或尚無文件） | `deploy.sh:58-62` |
| 驗證輸出 | 印服務網址與 `curl /api/healthz`、`/api/health` 驗證指令 | `deploy.sh:64-67` |

> 單實例（max-instances 1）+ session-affinity 是 WS 對戰的前提：所有連線落在同一 process，房間快取與記憶體狀態才一致。

### 5.11.2 Dockerfile（`Dockerfile`）

`node:22-slim` → `npm install --omit=dev`（layer 快取）→ 複製前端/後台/shared/online/server/assets → `ENV PORT=8080, NODE_ENV=production, FIRESTORE_ENABLED=1` → `EXPOSE 8080` → `CMD ["node", "server/index.js"]`。

### 5.11.3 環境變數總表

| 名稱 | 用途 | 預設 | 必填 | 來源 |
|---|---|---|---|---|
| `PORT` | 監聽埠（Cloud Run 注入 8080） | 8787 | 否 | `server/config.js:11` |
| `TURN_MS` | 回合行動鐘 | 60000 | 否 | `server/config.js:14` |
| `GRACE_MS` | 斷線寬限 | 90000 | 否 | `server/config.js:15` |
| `HEARTBEAT_MS` | WS ping 週期 | 30000 | 否 | `server/config.js:18` |
| `CHAT_BURST` | 聊天滑動窗口上限 | 5 | 否 | `server/config.js:21` |
| `CHAT_WINDOW_MS` | 聊天窗口 | 10000 | 否 | `server/config.js:22` |
| `CHAT_MIN_GAP_MS` | 聊天最小間隔 | 600 | 否 | `server/config.js:23` |
| `ROOM_SWEEP_MS` | 房間 sweep 週期 | 60000 | 否 | `server/config.js:26` |
| `FINISHED_TTL_MS` | finished 房 TTL | 24h | 否 | `server/config.js:29` |
| `STALE_TTL_MS` | 未結束房 TTL | 7 天 | 否 | `server/config.js:30` |
| `FIRESTORE_ENABLED` | 持久化開關（`"0"` 關閉） | 開 | 否 | `server/config.js:33` |
| `FIRESTORE_COLLECTION` | rooms collection 名 | `rooms` | 否 | `server/config.js:34` |
| `GCLOUD_PROJECT` | Firestore projectId | 未設（用 ADC 預設） | 否 | `server/config.js:35` |
| `APP_VERSION` | 覆寫版號顯示 | package.json version | 否 | `server/config.js:38` |
| `GOOGLE_CLIENT_ID` | 後台 OAuth audience（**登入必填**） | 未設（登入 503） | 後台必填 | `server/index.js:150,157` |
| `ADMIN_EMAILS` | 管理員 allowlist（逗號分隔） | `doggy.huang@gmail.com` | 否 | `server/auth.js:15-25`、`deploy.sh:12` |
| `ADMIN_SESSION_SECRET` | session HMAC 金鑰；留空則重啟全員登出 | 隨機 32 bytes | 建議必填 | `server/index.js:56`、`server/auth.js:162-164` |
| `IP_ALERT_HTTP_PER_MIN` | HTTP 洪水閥值 | 120 | 否 | `server/ip-monitor.js:23` |
| `IP_ALERT_WS_PER_MIN` | WS 訊息洪水閥值 | 600 | 否 | `server/ip-monitor.js:24` |
| `IP_ALERT_CONN_PER_MIN` | 連線風暴閥值 | 10 | 否 | `server/ip-monitor.js:25` |
| `IP_ALERT_HTTP_PER_HOUR` | HTTP 時流量閥值 | 2000 | 否 | `server/ip-monitor.js:26` |
| `NODE_ENV` | production 標記 | — | 否 | `Dockerfile:18` |

---

## 5.12 營運與可觀測性

| 項目 | 規格 | 來源 |
|---|---|---|
| 存活探測 | `GET /api/healthz` → 純文字 `ok`（`/healthz` 被 Google Frontend 保留才掛 `/api/` 下） | `server/index.js:113` |
| 版號驗證 | `GET /api/health` → `{ok, version}`；**部署後標準流程**：確認 `package.json` 版號已遞增並 commit → `bash deploy.sh` → `curl <正式機>/api/health` 比對版號一致 + `curl /api/healthz` | `AGENTS.md` 版號/部署規則 |
| 後台部署驗證 | `curl -s <url>/admin -o /dev/null -w '%{http_code}'` → 200；`curl -s <url>/api/admin/session` → `{"authenticated":false,…}` | `AGENTS.md` 管理後台備忘 |
| 資產版本注入 | HTML 的 `?v=__ASSET_VER__` 於請求時以檔案 sha1 前 8 碼取代（index.html 與 admin.html 共用）；內容變→URL 變→瀏覽器抓新版；檔案不存在時退回套件版號 | `server/index.js:74-92` |
| 日誌 | `console.log`/`console.error`：啟動訊息（持久化模式+版號）、`[api] /api/games failed`、`[admin] google auth failed`、`[admin] metrics series failed`、`[ws] handleMessage failed`、`[rooms] persist failed / pushLobby failed`、`metrics hour persist failed`、`announcement persist failed`、`ip monitor restore failed / ip alert persist failed` 等——失敗皆「記 log 不中斷服務」 | `server/index.js` 各處、`server/rooms.js:97,132` |
| 容量界線 | 分鐘桶 72h／小時點 90 天／IP 流量 7 天／告警 200 筆／追蹤 IP 5000 個／公告 50 則／聊天 50 則／lobby 名單 HTTP 20・WS 推播 50 | 各檔常數 |

---

## 5.13 測試策略（server/tests，`node --test`，共 10 檔 + 工具）

測試以注入（fake transport、fake now、fake persistence、本機 RSA keypair）隔離網路與計時器；`admin-routes.test.js` 起 `FIRESTORE_ENABLED=0` **絕不觸碰 Firestore**。

| 測試檔 | 行數 | 被保證的行為 |
|---|---|---|
| `room.test.js` | 285 | 建立者 token 認領 seat 0；第二人遞補即開打並雙方收 `state`；`spectate` 不占座；第三人成觀眾；同 token 第二視窗踢第一視窗（`connected-elsewhere` + close 4000）；斷線者以 token 重認領；非輪到者被拒；`actionApplied` 全場收到且 seq 只回動作者；非法動作回規則引擎中文錯誤；連五 gameOver；和棋同意/拒絕；認輸；abort（在線需同意、離線直接結束）；rematch 換先手重洗；落子清空協商；觀眾可聊不可操作；presence 結構（含 spectatorList）；toDoc/fromDoc 往返重建；sanitizeName 清洗；reasonText 對照 |
| `timers.test.js` | 170 | 行動鐘逾期→timeout 判負（deadline 含 serverNow）；輪到者斷線→鐘暫停+寬限窗；寬限逾期→forfeit；寬限內重連恢復剩餘時間；輪到離線者直接開寬限鐘；非輪到者斷線不影響；**長停機復活不溯及判負**（行動鐘轉暫停+全新寬限、至少剩 10 秒）；寬限中的房重啟→寬限重算；waiting/finished 無鐘；disconnect 後 evaluate 即時結算 |
| `chat.test.js` | 110 | 全房收到、座位署名；觀眾 `from:"spectator"` 帶名；canned 全白名單可用、未知 id 丟棄；burst 超限回 `rate-limited`（僅回本人）；600ms 最小間隔；清洗（控制字元/截 120 碼點/空白丟棄）；重連補發 50 則尾巴；被限速訊息不進歷史 |
| `guards.test.js` | 74 | 未知 `t`/非物件一律丟棄；join 欄位驗型與截斷（24/24/64）；action seq≥1 整數、x/y 整數；chat 截 500、canned 截 32；`accept` 必須 boolean；無欄位訊息直接放行；announcementAck 剝控制字元、截 64、剝完為空不合法 |
| `auth.test.js` | 126 | allowlist 預設與解析（不分大小寫去重）；session 簽驗 roundtrip、防竄改、過期、金鑰不符；TTL 12h、cookie header 格式；cookie 解析；randomSecret 格式；Google ID token 驗證（本機 RSA 自簽 + fetchCerts 注入）：aud/過期/email_verified/未知 kid/他人私鑰/malformed 全拒 |
| `admin-routes.test.js` | 409 | 未登入 401；有效 admin cookie 全端點 200（含 ip-stats 非法 range 退 24h）；config/google 端點檢查（503/400/401）；登出清 cookie；公告發佈清洗+廣播+已讀回條+新訂閱先收公告（順序）+空內容 400；metrics series granularity 驗證（預設 minute、非法 400）；IP 封鎖全流程（bad-ip/bad-duration 400、踢線 4003、新 WS 升級 403、HTTP 403、健康檢查豁免、DELETE 解封與 removed:false）；ip-stats 流量記錄可見；/admin 殼 200（或不存在 404） |
| `ip-monitor.test.js` | 174 | 計數累積+摺入小時桶；閥值告警（嚴格大於）與低於不告警；5 分鐘告警去重；conn-storm；top 10 排序；封鎖/到期自動解除/手動解封/permanent；persistence 跨重啟還原封鎖、丟棄已過期；時長白名單與閥值常數；looksLikeIp |
| `metrics.test.js` | 145 | 分鐘桶統計（http/wsMsg/gauge 峰值/connPeak）；小時彙總寫 persistence；日彙總採 UTC+8 日界；live 快照；dayKey；start/stop 計時器管理 |
| `announcements.test.js` | 105 | 發佈成當前公告含觸及人數；同名已讀去重、未知 id/空名忽略；新公告取代舊公告但舊的仍可累積已讀；歷史 50 上限；內容清洗 500 字；persistence 保存+還原；persistence 掛掉不影響功能 |
| `store.test.js` | 134 | InMemoryStore CRUD；listActive 只列 playing；lobby 曝光規則（playing 坐滿必列、waiting 30 秒內不列、finished 5 分鐘保留後消失）；並發載入合併成同一實例；sweep 逐出 idle finished（store 留到 TTL）；sweep 刪除過期房（含 store）；房間活動 50ms debounce 通知 lobby |

執行：`npm test`（root，= `node --test tests/*.test.js server/tests/*.test.js`，`package.json:7`）；覆蓋率：`npm run coverage`。

---

### 附錄 5.A：WS 訊息一頁速查

```
client → server : subscribeLobby, join{roomId,playerToken?,name?,spectate?},
                  action{seq,action:{x,y}}, chat{text}, canned{id},
                  drawOffer, drawResponse{accept}, abortRequest, abortResponse{accept},
                  resign, rematch, rematchResponse{accept}, announcementAck{id}
server → client : lobby, announcement, joined, state, actionApplied(seq 僅動作者),
                  deadline, presence, chat, invalid, error,
                  gameOver, drawOffered/drawRejected, abortOffered/abortRejected,
                  rematchOffered/rematchRejected, rematchStart
close codes     : 4000 connected-elsewhere · 4003 ip-blocked
```