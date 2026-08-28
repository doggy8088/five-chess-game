# 一、產品概述與平臺架構（Overview & Platform）

| 項目 | 內容 |
|---|---|
| 章節版本 | v1.0 |
| 撰寫日期 | 2026-08-29 |
| 產品名稱 | 五子棋 · Five Chess（Gomoku） |
| 產品版號 | v0.3.2（來源：`package.json:3`；同步顯示於 `index.html:205`、`index.html:247`） |
| 文件狀態 | 正式（Approved） |
| 資料來源 | 原始碼逐檔檢視（README.md、AGENTS.md、index.html、deploy.sh、Dockerfile、server/*、online/*、assets/*、tests/*） |

> 本章為開發規格書的總綱：定義產品是什麼、給誰用、跑在什麼平臺上、怎麼部署與發佈。所有論述皆附原始檔證據（`檔案:行號`），後續章節（規則引擎、通訊協定、伺服器、前端渲染、管理後台）均以本章為前提。

---

## 1.1 產品概述與定位

### 1.1.1 一句話定位

**「開啟網頁即玩的 3D 五子棋」**——以瀏覽器為唯一執行環境，零安裝、零註冊、零建置，單機可對戰 AI，上線可與好友即時對弈並開放觀戰。

> 產品自我描述（原文）：「3D 五子棋網頁遊戲：15×15 棋盤、三種難度 AI 對戰與雙人模式，three.js 3D 渲染，離線自動切換 2D Canvas，免安裝、免註冊，開啟即玩。」— `README.md:1`、`index.html:6`（meta description 兩者逐字一致）。

### 1.1.2 解決的問題

| 現況痛點 | 本產品的解法 | 證據 |
|---|---|---|
| 傳統棋類網站要裝 App／外掛 | 純 Web，任何現代瀏覽器開連結即玩 | `index.html:30-56`（JSON-LD 標明 `WebApplication`、`operatingSystem: "Any"`、`isAccessibleForFree: true`、價格 0 TWD） |
| 3D 遊戲通常需打包建置 | 前端零 build：所有 JS/CSS 為原生檔案直接載入 | `AGENTS.md`「架構鐵則」；唯一第三方資源 three.js 以 CDN 載入（`index.html:78`） |
| 網路不穩／3D 引擎載入失敗即不能玩 | 2D Canvas 自動降級備援，遊戲始終可玩 | `index.html:76-78` 註解「若離線／被擋住時，頁面會自動改用 2D Canvas 渲染」；`index.html:12-13`（雙 canvas：`#gl` 與 `#fallback`） |
| 想跟朋友連線對弈要自架伺服器 | 內建線上對戰服務（Cloud Run 託管），邀請連結一鍵開打 | `README.md:3`、`deploy.sh:40-52` |
| 線上對戰易被外掛／前端作弊 | **server-authoritative**：規則引擎 `game.js` 為純函式、client 與 server 共用同一份，裁決權在伺服器 | `AGENTS.md`「架構鐵則」；`README.md`「技術棧」 |

### 1.1.3 核心賣點（六大支柱）

| # | 賣點 | 內容摘要 | 主要證據 |
|---|---|---|---|
| 1 | **3D 棋盤** | three.js（v0.160.0，CDN `unpkg.com`）渲染立體棋盤，可拖曳旋轉、滾輪縮放 | `index.html:78`；`README.md`「特色」 |
| 2 | **零安裝、零註冊、零建置** | 免安裝、免註冊、開啟即玩；前端不用 bundler | `README.md:1`；`AGENTS.md`「架構鐵則」 |
| 3 | **線上即時對戰** | 房間邀請連結（`/r/{roomId}`）、座位系統（執黑先手／白方遞補／觀眾）、回合鐘、斷線重連、協商功能（和棋／提前結束／認輸／再來一局） | `README.md`「線上對戰」表；`online/ui.js:275-278`（`/r/{roomId}` 深連結解析） |
| 4 | **觀戰與戰情中心** | 首頁即時戰況（進行戰局、在線棋手、觀戰人數）、WS 推播＋HTTP 輪詢兜底、「只看交戰中」開關、一鍵進入觀戰 | `README.md`「線上對戰」表「戰情中心」列；`index.html:224-243`（`#war-center` 區塊） |
| 5 | **聊天室** | 雙分頁抽屜（聊天室＋人員名單）、12 句快速訊息、未讀徽章、限速防灌水、觀眾可聊天 | `README.md`「線上對戰」表「聊天室」列；限速參數 `server/config.js:22-24` |
| 6 | **管理後台** | `/admin`：即時指標卡、全站公告已讀追蹤、Chart.js 負載圖表、IP 監控與封鎖踢線，Google 登入＋email allowlist | `README.md`「管理後台」節；`admin.html:144`（Chart.js 本機打包載入） |

### 1.1.4 產品邊界（現況不包含）

- **無帳號系統**：線上身份僅是「暱稱＋座位 token」（`server/store.js:3-10` RoomDoc 的 `seats: [{token,name}|null]`），非註冊制。
- **非完整 PWA**：無 Web App Manifest、無 Service Worker（全 repo grep `manifest|serviceWorker` 零命中，詳見 1.3.3），不能「安裝到桌面」；行動支援以「瀏覽器開好開滿」為策略。
- **單實例上限**：正式機 `--max-instances 1`（`deploy.sh:48`），大廳名單靠單實例記憶體一致，非水平擴展架構（詳 1.4.2）。

---

## 1.2 目標使用者與使用情境

### 1.2.1 目標使用者

| 使用者 | 需求特徵 | 產品對應 |
|---|---|---|
| 休閒玩家（含長輩／新手） | 不想裝東西、想立刻玩一局 | 開連結即玩；「簡單」模式規則最寬鬆（長連也算勝） |
| 棋力愛好者 | 想練棋、要求正統規則 | 三種難度＝三種規則集：自由／標準／連珠（黑棋三大禁手、VCF 攻防 AI） |
| 親友團／辦公室同好 | 兩人想立刻連線對弈，懶得約時間裝軟體 | 建立房間 → 邀請連結／QR Code → 對方打開即坐上白方自動開打 |
| 直播／群眾旁觀者 | 想看戰況、湊熱鬧 | 戰情中心一鍵觀戰、聊天室可發言 |
| 站長（作者本人） | 營運監控、防灌爆 | `/admin` 管理後台（指標、公告、IP 監控封鎖） |

### 1.2.2 使用情境（User Journeys）

**情境 A：好友對戰（核心情境）**
1. 玩家一在首頁點「線上對戰」→「建立房間對戰」（`index.html:197-199`、`index.html:222`）。
2. 選規則集（自由／標準／連珠）＋輸入暱稱（`index.html` 建立房間表單，規則集描述 `#ruleset-desc`）。
3. 取得不可猜邀請連結 `/r/{roomId}`，附 QR Code 與一鍵複製（`README.md`「房間邀請」；QR 用本機打包的 `assets/vendor/qrcode.min.js`，載入點 `index.html:391`，註解「無網路依賴」見 `online/ui.js:1336`）。
4. 玩家二開連結 → 直入房間、遞補白方自動開打；第三人起為觀眾（`README.md`「座位系統」）。
5. 中途斷線：同一連結重開即憑 `playerToken` 無縫續戰；WS 指數退避自動重連（`README.md`「斷線重連」；`online/` 模組分工 `socket.js` / `session.js` / `tokens.js`，見 `README.md` 專案結構）。

**情境 B：直播／公開觀戰**
1. 首頁「即時戰況 · 戰情中心」即時列出進行戰局、在線棋手、觀戰人數（`index.html:224-243`；`README.md`「戰情中心」）。
2. WS 推播為主、HTTP 輪詢兜底；「只看交戰中」開關、膠著／激戰標籤（`README.md` 同上）。
3. 點列表進入觀戰；等待房滿 30 秒才公開曝光、終局保留 5 分鐘（`README.md` 同上；伺服器端清單邏輯 `server/firestore-store.js:36-44` `listActive` 交戰中＋保留期內已結束房都上板）。

**情境 C：單機練習（離線可用）**
1. 首頁點「開始遊戲」（對戰 AI／雙人同屏 · 3D 棋盤，`index.html:193-196`）。
2. 三難度 AI：簡單＝有隨機性的貪婪評估；中等＝貪婪＋立即取殺／擋殺；困難＝威脅感知 alpha-beta（深度 3）＋VCF 連續衝四殺攻防（`README.md`「AI 設計摘要」表）。
3. 純靜態環境（GitHub Pages／本機 `file://`）下，線上探測失敗 → 線上功能整體隱藏，單機玩法完全不受影響（`online/ui.js:269-273`；`index.html:201`）。

**情境 D：行動裝置**
1. viewport 鎖定 `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`，避免對局中誤觸縮放（`index.html:5`）。
2. iOS「加入主畫面」有專用圖示：`apple-touch-icon.png` 180×180（`index.html:73`；`assets/apple-touch-icon.png`）。
3. 終局看板「分享」在行動版開啟系統分享選單、或「下載」直接存 PNG（`README.md`「介面元素」節）。
4. 無 App、無安裝：手機瀏覽器直開即玩（JSON-LD `operatingSystem: "Any"`，`index.html:40`）。

**情境 E：站長營運**
1. 開 `/admin`，Google 登入（僅 `ADMIN_EMAILS` allowlist 可進入，`README.md`「管理後台」）。
2. 看即時指標（進行戰局／在線棋手／觀戰人數／連線數，`/api/admin/metrics/live`）、發全站公告（前台強制閱讀＋已讀回條追蹤）、看 Chart.js 負載曲線（每分鐘／每小時／每日）。
3. IP 異常自動告警＋手動封鎖（限時 5m～7d 或永久），被封鎖 IP 的 WS 連線即被踢線（`README.md`「IP 監控與封鎖踢線」；閥值預設 `server/ip-monitor.js:23-26`）。

---

## 1.3 平臺選擇與理由

### 1.3.1 主平臺：瀏覽器 Web（桌面＋行動）

**決策**：以瀏覽器為唯一發行平臺；桌面不打包、行動不發 App。

| 考量 | Web | Native（iOS/Android） | Electron |
|---|---|---|---|
| 觸達門檻 | **連結即達**（邀請連結 `/r/{roomId}` 可直接貼進聊天群） | 需安裝 App、過商店審核 | 需下載安裝包 |
| 版本更新 | **部署即生效**（HTML no-cache＋資產內容雜湊破快取，`server/index.js:336-346`） | 要等使用者升級 | 要重新打包發佈 |
| 邀請傳播 | URL＋QR Code 即分享（`index.html:391`） | 需 deep link 基建 | 不適用 |
| 3D 能力 | WebGL 足夠（棋盤是低多邊形場景，非重度 3D） | 過剩 | 過剩 |
| 維護成本 | **零 build 前端，任何編輯器改完即上線**（`AGENTS.md`「前端零 build」） | 雙平臺雙程式碼庫 | 第三套包裝 |
| 本產品的目標使用者 | 休閒玩家，連結來自聊天軟體 | — | — |

**結論**：五子棋的核心傳播路徑是「把邀請連結貼給朋友」（`README.md`「房間邀請」），Web 是唯一讓這條路徑零摩擦的平臺；Native/Electron 對此產品的增益（離線安裝、系統整合）遠低於其成本，故明確不採用。遊戲本就離線可玩（2D 備援），Native 的「離線」賣點已被覆蓋。

### 1.3.2 技術棧與零 build 鐵律

| 層 | 技術 | 證據 |
|---|---|---|
| 3D 渲染 | three.js v0.160.0，唯一第三方 CDN 資源 | `index.html:78` |
| 2D 備援 | 原生 Canvas（`#fallback`） | `index.html:12-13` |
| 樣式 | 單一 `styles.css`（原生檔直接載入，帶 `?v=__ASSET_VER__`） | `index.html:74` |
| 線上通訊 | 原生 WebSocket，`wss://`（https 環境自動升級） | `online/socket.js:10-11` |
| 第三方本機打包 | qrcode（房間 QR）、Chart.js（後台負載圖） | `index.html:391`、`admin.html:144`；檔案 `assets/vendor/qrcode.min.js`、`assets/vendor/chart.umd.min.js` |
| 伺服器 | Node + Express 5 + ws 8（單一 port 同時服務靜態檔／REST/WS） | `package.json:14-19`；`Dockerfile:1` 註解 |
| 遊戲邏輯 | `game.js` 為 UMD 純函式模組，client 與 server 共用 | `README.md`「技術棧」 |

> **鐵則**（`AGENTS.md`「架構鐵則」）：「前端零 build：所有 JS/CSS 都是原生檔案直接載入（唯一的第三方資源 three.js / qrcode / Chart.js 以 `assets/vendor/` 或 CDN 載入），新增前端功能不得引入 bundler。」——任何前端新功能的設計都必須遵守此約束。

### 1.3.3 PWA／行動裝置支援現況（證據式盤點）

| 項目 | 現況 | 證據 |
|---|---|---|
| Favicon 系列 | ✅ 完整：ICO＋PNG 16/32/48/192/512 | `index.html:67-72`；`assets/favicon-{16x16,32x32,48x48,192,512}.png`、`favicon.ico` |
| apple-touch-icon | ✅ 180×180（iOS 加入主畫面用） | `index.html:73`；`assets/apple-touch-icon.png` |
| theme-color | ✅ `#0b1020`（深空藍，配合遊戲底色） | `index.html:11` |
| OpenGraph 分享圖 | ✅ 1200×630，站內自託管 | `index.html:20-23`；`og-image.png`（實檔 549 KB） |
| Twitter Card | ✅ `summary_large_image` | `index.html:27-28` |
| JSON-LD 結構化資料 | ✅ `WebApplication`、免費、zh-Hant-TW | `index.html:30-56` |
| Web App Manifest | ❌ 無（全 repo 無 `manifest.webmanifest`／`<link rel="manifest">`） | grep `manifest` 於 `index.html`、`online/*`、`app.js`、`server/*` 零命中 |
| Service Worker | ❌ 無（無離線快取、無推播） | grep `serviceWorker` 零命中 |
| `apple-mobile-web-app-capable` / standalone | ❌ 未宣告 | grep 零命中 |
| 行動版 UI | ✅ 響應式 HUD＋觸控落子；viewport 禁用縮放 | `index.html:5`；`README.md`「介面元素」 |

**定位**：目前是「**PWA-ready 但未宣告 PWA**」——資產（圖示、theme-color、分享卡）已齊，缺 manifest 與 service worker 即可升級為可安裝 PWA；此為後續章節的候選強化項，非現況功能。

### 1.3.4 SEO 與可發現性

- `robots.txt`：全站允許所有爬蟲（`robots.txt:1-2`：`User-agent: * / Allow: /`）。
- canonical 指向 GitHub Pages 網域 `https://five-chess-game.gh.miniasp.com/`（`index.html:12`）——注意：線上主站已遷 Cloud Run（見 1.4），canonical 尚未同步，屬已知待校準項。
- OG/分享 URL 同樣指向 GitHub Pages 網域（`index.html:12,18-20`）。
- 語系標記 `zh-Hant-TW`（`index.html:3`、`index.html:47` `inLanguage`）。

---

## 1.4 部署平臺：雙部署架構

本產品採**同一份程式碼、兩種部署形態**：

```
                         ┌──────────────────────────────┐
   同一份原始碼  ──────▶  │  GitHub Pages（純靜態託管）   │──▶ 單機版：AI＋雙人同屏
                         │  CNAME: five-chess-game.     │    線上功能自動隱藏
                         │  gh.miniasp.com (CNAME:1)    │
                         └──────────────────────────────┘
                         ┌──────────────────────────────┐
        ──────────────▶  │  Google Cloud Run（容器）     │──▶ 線上版：單機功能＋線上對戰
                         │  project: vertex-ai-sprint   │    ＋戰情中心＋管理後台
                         │  region: asia-east1          │
                         │  service: gomoku             │
                         │  https://gomoku-wpnna43hmq-  │
                         │  de.a.run.app                │
                         │  (deploy.sh:5-7,61-65;       │
                         │   AGENTS.md「正式環境網址」)  │
                         └──────────────────────────────┘
```

### 1.4.1 GitHub Pages：單機版靜態站

| 項目 | 內容 | 證據 |
|---|---|---|
| 自訂網域 | `five-chess-game.gh.miniasp.com` | `CNAME:1`（GitHub Pages 自訂網域檔）；`Dockerfile:11` 也把 `CNAME*` 一併複製進映像 |
| 網站性質 | 純靜態（無後端），只提供單機玩法 | `README.md`：「純靜態部署（如 GitHub Pages）會自動探測不到對戰伺服器，此時線上功能整體隱藏、單機玩法不受影響」 |
| 歷史地位 | **舊網址**（原線上試玩入口），現為單機版站；README 標註「已 301/meta 重導向至 Cloud Run」 | `README.md:6` |
| 佔位符行為 | 靜態託管時 `?v=__ASSET_VER__` 只是普通查詢字串，不影響載入（無伺服器注入，也無破快取效果） | `index.html:57-59` 註解 |

### 1.4.2 Cloud Run：線上對戰主站

| 項目 | 值 | 證據 |
|---|---|---|
| GCP 專案 | `vertex-ai-sprint` | `deploy.sh:5` |
| 區域 | `asia-east1` | `deploy.sh:6` |
| 服務名 | `gomoku` | `deploy.sh:7` |
| 正式網址 | `https://gomoku-wpnna43hmq-de.a.run.app`（自訂網域 `gomoku.game.miniasp.com` 見 `README.md:5`） | `AGENTS.md`「正式環境網址」；`deploy.sh:61-62` 部署完輸出 `status.url` |
| 認證 | `--allow-unauthenticated`（遊戲對玩家全開；後台另有 Google 登入＋allowlist） | `deploy.sh:51`；`server/auth.js:6-18` |
| WS 親和 | `--session-affinity`：WS 長連線綁同一實例 | `deploy.sh:45` |
| 實例策略 | `--min-instances 0 --max-instances 1`：**單實例**讓記憶體 lobby 名單跨連線一致 | `deploy.sh:47-48`；`README.md` 部署節「單實例讓記憶體 lobby 名單一致」 |
| 資源 | `--memory 512Mi --cpu 1 --timeout 3600`（1 小時超時容納長對局＋斷線重連） | `deploy.sh:46,49-50` |
| 入口容器 | `node:22-slim`，`CMD ["node","server/index.js"]`，單一服務同時提供靜態檔＋REST＋WS | `Dockerfile:2,25`；`Dockerfile:1` 註解 |
| 持久化 | Firestore（`rooms/{roomId}` 一房一文件），重啟後房間可重建；`FIRESTORE_ENABLED=0` 時退回 InMemoryStore | `server/index.js:583-595`；`server/firestore-store.js:1-5`；`server/store.js:1-11`（RoomDoc 欄位） |
| CPU throttling 對策 | 計時一律以 deadline 時間戳**惰性判定**，setTimeout 僅輔助（Cloud Run 縮容下計時器不可靠） | `AGENTS.md`「架構鐵則」；`server/config.js:1-3` 註解 |

### 1.4.3 線上功能的探測與降級（兩站功能差異的實作機制）

線上層**不是**寫死啟用，而是開機時探測後端：

- 前端載入後呼叫 `fetch("/api/health", { cache: "no-store" })`（`online/ui.js:259-260`）。
- **成功**（`res.ok` 且 `data.ok`）：`serverOk = true`；以回傳的 `data.version` 更新版號顯示；**解鎖入口畫面的「線上對戰」按鈕**（`entryOnline.hidden = false`）；啟動 URL 路由與戰情中心（`online/ui.js:261-268`）。
- **失敗**（404／網路錯）：`serverOk = false`，「純靜態部署：隱藏整個線上功能」，並顯示「線上對戰需對戰伺服器 — 目前以單機模式執行」（`online/ui.js:269-273`；文案 `index.html:201`）。
- 對應地，入口按鈕 `#btn-entry-online` 在 HTML 中**預設 `hidden`**（`index.html:197`），線上層容器 `#online-layer` 預設 `hidden` 且註解明寫「探測到 /api/health 才啟用」（`index.html:211`）。

> 這是「一份程式碼、兩種部署」的關鍵機制：GitHub Pages 上 `/api/health` 是 404 → 線上功能整體消失；Cloud Run 上是 200 → 完整線上版。

### 1.4.4 兩站差異一覽

| 面向 | GitHub Pages（單機版） | Cloud Run（線上版） |
|---|---|---|
| 網址 | `https://five-chess-game.gh.miniasp.com/`（`CNAME:1`） | `https://gomoku-wpnna43hmq-de.a.run.app`（`AGENTS.md`） |
| 後端 | 無 | Node 22 + Express + ws（`Dockerfile`） |
| 持久化 | 無 | Firestore TTL（`deploy.sh:54-59`） |
| 版號顯示 | 手動寫死的 `.entry-version`（`index.html:205`） | `/api/health` 回傳版號動態覆寫（`online/ui.js:266`） |
| 線上對戰／觀戰／聊天 | ❌ 自動隱藏（`online/ui.js:269-273`） | ✅ |
| 戰情中心 | ❌（`#war-center` 預設 `hidden`，`index.html:228`） | ✅ |
| 管理後台 `/admin` | ❌ | ✅（`server/index.js:334`） |
| SPA 路由（`/r/:roomId`、`/online`、`/game`） | ❌（純靜態無路由） | ✅（`server/index.js:309-322`） |

---

## 1.5 執行環境與組態

### 1.5.1 執行環境

| 項目 | 值 | 證據 |
|---|---|---|
| Node 版本 | **node:22-slim**（Node 22 LTS） | `Dockerfile:2`；`README.md`「Node 22 + express + ws」 |
| 依賴安裝 | `npm install --omit=dev`（僅正式依賴） | `Dockerfile:8` |
| 映像內容 | 靜態檔（index.html/app.js/game.js/styles.css/robots.txt/favicon.ico/CNAME）＋admin 三件套＋shared＋online＋server＋assets | `Dockerfile:11-16` |
| 容器埠 | `ENV PORT=8080`、`EXPOSE 8080`（Cloud Run 實際注入自己的 `PORT`） | `Dockerfile:18,23` |
| 容器預設 | `NODE_ENV=production`、`FIRESTORE_ENABLED=1` | `Dockerfile:19-21` |
| 預設監聽 | 本機開發 8787（`PORT` 未設時） | `server/config.js:12` |
| 建置排除 | `node_modules`、`.git`、`tests`、`*.md`、`.DS_Store` 等 | `.dockerignore`、`.gcloudignore`（兩檔內容一致，加快 Cloud Build 上傳） |

### 1.5.2 npm scripts（`package.json:5-11`）

| Script | 指令 | 用途 |
|---|---|---|
| `test` | `node --test tests/*.test.js server/tests/*.test.js` | 全部測試（前端/E2E＋伺服器單元），Node 內建測試器，無第三方測試套件 |
| `coverage` | `node --test --experimental-test-coverage …` | 同上＋覆蓋率 |
| `serve` | `npx --yes serve -l 4321 .` | 純靜態伺服器（模擬 GitHub Pages；線上功能探測失敗自動隱藏） |
| `dev` | `FIRESTORE_ENABLED=0 node server/index.js` | 本機起對戰伺服器（InMemoryStore，http://localhost:8787） |
| `start` | `node server/index.js` | 正式起動（容器 CMD 同款） |
| `deploy` | `bash deploy.sh` | 一鍵部署 Cloud Run |

### 1.5.3 正式依賴（`package.json:14-19`；安裝數以 lock 檔為準 `package-lock.json:8-13`）

| 套件 | 版本 | 用途 |
|---|---|---|
| `express` | ^5.2.1 | 靜態檔＋REST API |
| `ws` | ^8.21.3 | WebSocket（`/ws` upgrade，`server/index.js:354-360`） |
| `@google-cloud/firestore` | ^9.0.0 | 正式環境持久化 |
| `qrcode` | ^1.5.4 | 房間邀請 QR Code（瀏覽器端用本機打包版 `assets/vendor/qrcode.min.js`） |

> **注意**：`package-lock.json` 頂部 metadata 仍為 `version: 0.1.0`（`package-lock.json:2-3`），與 `package.json` 的 `0.3.2` 不同步——版號遞增流程只改 `package.json` 與 `index.html`（`AGENTS.md`「版號規則」），lock 檔版本欄位屬無害漂移，但建議未來版號腳本一併處理。

### 1.5.4 環境變數清單（逐一列出：用途與預設值）

**（A）伺服器常數類**——全部可 env 覆寫，讀取集中在 `server/config.js`：

| 變數 | 用途 | 預設值 | 證據 |
|---|---|---|---|
| `PORT` | HTTP/WS 監聽埠 | `8787`（本機）；Cloud Run 自帶注入、Dockerfile 設 8080 | `server/config.js:12`；`Dockerfile:18` |
| `TURN_MS` | 回合鐘：每手時限 | `60000`（60 秒） | `server/config.js:15` |
| `GRACE_MS` | 斷線重連寬限 | `90000`（90 秒） | `server/config.js:16` |
| `HEARTBEAT_MS` | WS 心跳週期（ping 無 pong 即 terminate） | `30000` | `server/config.js:19` |
| `CHAT_BURST` | 聊天限速：滑動窗口內最大則數 | `5` | `server/config.js:22` |
| `CHAT_WINDOW_MS` | 聊天限速：滑動窗口長度 | `10000` | `server/config.js:23` |
| `CHAT_MIN_GAP_MS` | 聊天限速：兩則最小間隔 | `600` | `server/config.js:24` |
| `ROOM_SWEEP_MS` | 房間快取 sweep 週期 | `60000` | `server/config.js:27` |
| `FINISHED_TTL_MS` | 已結束房間保留時限 | `86400000`（24 小時） | `server/config.js:30` |
| `STALE_TTL_MS` | 未結束房間最後更新後的保留時限 | `604800000`（7 天） | `server/config.js:31` |
| `FIRESTORE_ENABLED` | 持久化模式開關：`"0"`＝InMemoryStore，其餘＝FirestoreStore | 未設＝**啟用 Firestore**（`!== "0"`） | `server/config.js:34`；`server/index.js:583-595` |
| `FIRESTORE_COLLECTION` | 房間文件 collection 名 | `rooms` | `server/config.js:35` |
| `GCLOUD_PROJECT` | Firestore client projectId | 未設＝用 ADC 預設 | `server/config.js:36` |
| `APP_VERSION` | 對外版號（覆寫 package.json） | 未設＝`package.json` 的 `version` | `server/config.js:39` |
| `NODE_ENV` | 執行環境標記 | 容器內 `production` | `Dockerfile:19` |

**（B）管理後台類**（`/admin`）：

| 變數 | 用途 | 預設值 | 證據 |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client id（登入 ID token 的 audience；經 `/api/admin/config` 公開給登入頁） | 無——**未設無法登入後台** | `server/index.js:6`；`deploy.sh:11` |
| `ADMIN_EMAILS` | 管理員 email allowlist（逗號分隔） | `doggy.huang@gmail.com` | `server/auth.js:17-18` |
| `ADMIN_SESSION_SECRET` | 後台 session cookie 的 HMAC 簽章金鑰 | 未設時每次重啟隨機產生（**重啟即全員登出**） | `server/index.js:8`；`server/index.js:57` |
| （常數）`ADMIN_SESSION_TTL_MS` | 後台 session 有效期 | 12 小時（非 env，程式常數） | `server/auth.js:13` |

**（C）IP 異常告警閥值類**（`server/ip-monitor.js:23-26`）：

| 變數 | 用途 | 預設值 |
|---|---|---|
| `IP_ALERT_HTTP_PER_MIN` | 單一 IP 每分鐘 HTTP 請求告警閥值 | `120` |
| `IP_ALERT_WS_PER_MIN` | 單一 IP 每分鐘 WS 訊息告警閥值 | `600` |
| `IP_ALERT_CONN_PER_MIN` | 單一 IP 每分鐘 WS 連線建立告警閥值 | `10` |
| `IP_ALERT_HTTP_PER_HOUR` | 單一 IP 每小時 HTTP 請求告警閥值 | `2000` |

---

## 1.6 版號與發佈流程

### 1.6.1 版號的資料流

```
package.json "version" (0.3.2)
        │
        ├─(讀取)─▶ server/config.js:39  VERSION = APP_VERSION || package.json.version
        │              │
        │              └─(對外)─▶ /api/health → { ok: true, version }   (server/index.js:114)
        │                             │
        │                             └─(前端探測)─▶ online/ui.js:266  els.version = "v"+data.version
        │                                             （覆寫 index.html:247 的 #online-version）
        │
        └─(手動)─▶ index.html:205 .entry-version "v0.3.2"   ← 純靜態站讀不到 /api/health，
                                                              必須人工同步（AGENTS.md 明文「手動寫死，需同步更新」）
```

### 1.6.2 版號規則（專案強制規範，`AGENTS.md`「版號規則」）

1. **版號來源**是 `package.json` 的 `version`，經 `/api/health` 公開。
2. **每一次部署或發佈都必須遞增版號**：一般修錯用 patch +1（手動改 `package.json` 與 `index.html` 的入口版號並一起 commit）；功能較大的版本用 minor/major 遞增。
3. 部署前先確認版號已遞增並 commit，再執行 `bash deploy.sh`；部署後用 `curl <正式機>/api/health` 驗證版號與剛 commit 的一致。
4. **每次 commit 都要一併遞增版號**（`package.json` + `index.html`），版號變更也要寫進 commit 內文（`AGENTS.md`「Git 提交規則」）。
5. Commit 訊息必須為繁體中文詳細 log（`feat(範圍): 摘要`／`fix(範圍): 摘要`＋Markdown 條列內文）。

### 1.6.3 deploy.sh 一鍵部署流程（`deploy.sh:1-65`，逐步）

| 步驟 | 動作 | 證據 |
|---|---|---|
| 1. 參數帶入 | 專案/區域/服務：`vertex-ai-sprint` / `asia-east1` / `gomoku`（可用 env 覆寫） | `deploy.sh:5-7` |
| 2. 後台環境變數 | 從本機環境帶入 `GOOGLE_CLIENT_ID`、`ADMIN_EMAILS`（預設 `doggy.huang@gmail.com`）、`ADMIN_SESSION_SECRET` | `deploy.sh:9-13` |
| 3. **沿用正式機現值**（防呆核心） | 本機未設 `GOOGLE_CLIENT_ID`/`ADMIN_SESSION_SECRET` 時，`gcloud run services describe` 讀取正式機現有 env 回填——**避免每次部署把 secret 清空（會全員被登出）** | `deploy.sh:19-29` |
| 4. 缺漏警告 | 仍未齊全時印警告（CLIENT_ID 留空→無法登入 /admin；SECRET 留空→重啟後 session 失效） | `deploy.sh:31-35` |
| 5. 啟用 API | run / firestore / cloudbuild 三個 API | `deploy.sh:37-38` |
| 6. Cloud Build 建置＋部署 | `gcloud run deploy --source .`（原始碼直接觸發 Cloud Build）；旗組：`--session-affinity`（WS 綁實例）、`--timeout 3600`、`--min-instances 0 --max-instances 1`（單實例）、`--memory 512Mi --cpu 1`、`--allow-unauthenticated`；env 一次設定 `FIRESTORE_ENABLED=1, FIRESTORE_COLLECTION=rooms, NODE_ENV=production, GOOGLE_CLIENT_ID, ADMIN_EMAILS, ADMIN_SESSION_SECRET` | `deploy.sh:40-52` |
| 7. Firestore TTL | `gcloud firestore fields ttls update expireAt --collection-group=rooms --enable-ttl`：finished 房 24h／未結束房 7 天，過期房間文件自動刪除；首次部署需 rooms collection 已有 `expireAt` 欄位文件 | `deploy.sh:54-59`；TTL 欄位寫入 `server/firestore-store.js:57`；保留時限 `server/config.js:30-31` |
| 8. 輸出與驗證提示 | 取 `status.url` 印出正式網址，提示 `curl $URL/api/healthz` 與 `curl $URL/api/health` | `deploy.sh:61-65` |

> 部署後人工驗證（`AGENTS.md`「部署規則」）：`curl https://gomoku-wpnna43hmq-de.a.run.app/api/health`（版號須與 commit 一致）、`/api/healthz`；後台另驗 `/admin` 回 200、`/api/admin/session` 回 `{"authenticated":false,...}`。

### 1.6.4 發佈後的快取策略（與版號聯動）

| 資產 | 快取策略 | 證據 |
|---|---|---|
| `index.html`／`admin.html`／SPA 路由 | `Cache-Control: no-cache`（部署後不拿舊殼） | `server/index.js:111,311-334,342` |
| 帶 `?v=` 的資產 | `public, max-age=31536000, immutable`（一年長快取） | `server/index.js:344` |
| 無 `?v=` 的靜態檔 | `public, max-age=3600` | `server/index.js:345` |
| `?v=` 值 | 伺服器請求時以**檔案內容 sha1 前 8 碼**注入（`?v=__ASSET_VER__` 佔位符替換；index.html 與 admin.html 共用）；檔案不存在時退回套件版號 | `server/index.js:74-91` |

---

## 1.7 健康檢查與營運端點

### 1.7.1 健康檢查（本產品的兩個端點）

| 端點 | 方法 | 回應 | 用途 | 證據 |
|---|---|---|---|---|
| `/api/healthz` | GET | `text/plain`：`ok` | 存活探測（liveness）。**不用 `/healthz`**：該路徑被 Google Frontend 保留，故掛在 `/api/` 下 | `server/index.js:113`（行內註解） |
| `/api/health` | GET | `application/json`：`{"ok":true,"version":"0.3.2"}` | 存活＋**版號公開**：部署驗證（版號是否生效）、前端線上功能探測的依據 | `server/index.js:114`；版號來源 `server/config.js:39` |

**`/api/health` 的三個消費者**：

1. **前端線上探測**（`online/ui.js:259-273`）：決定線上功能是否啟用（見 1.4.3）。
2. **部署驗證**（`deploy.sh:65`、`AGENTS.md`）：部署後比對版號。
3. **人類營運**：一行 curl 確認新版已生效。

### 1.7.2 其他營運相關端點（總覽）

| 端點 | 用途 | 證據 |
|---|---|---|
| `/api/games` | 戰情中心 HTTP 兜底：進行中戰局清單（WS 推播為主、輪詢兜底） | `server/index.js:116-122` |
| `POST /api/rooms` | 建立房間（REST 入口） | `server/index.js:297` |
| `/ws` | WebSocket upgrade（含 IP 封鎖拒絕與既有連線踢除）；非 `/ws` 路徑直接 destroy | `server/index.js:354-360` |
| `/r/:roomId`、`/online`、`/game` | SPA 路由（房間深連結／線上大廳／本地遊戲） | `server/index.js:309-322` |
| `/admin` | 管理後台殼（admin.html 版本注入＋Google 登入） | `server/index.js:334`；`README.md`「管理後台」 |
| `/api/admin/*` | 後台 API（登入／session／config／公告／指標／IP 監控封鎖） | `server/index.js:1-10` 檔頭註解 |
| 代理設定 | `trust proxy = true`：真實 client IP 取自 `X-Forwarded-For`（Cloud Run 於 Google Front End 終結 TLS） | `server/index.js:51-53` |
| 心跳 | WS 30s ping／無 pong terminate（`HEARTBEAT_MS`） | `server/index.js:4`；`server/config.js:19` |

---

## 1.8 平臺矩陣（章節規格表）

以「部署形態 × 功能」列出差異。判定依據：線上功能皆以 `/api/health` 探測成敗為開關（`online/ui.js:257-273`）。

| 功能 | GitHub Pages 單機版 | Cloud Run 線上版 | 依據 |
|---|:---:|:---:|---|
| 15×15 五子棋基本對局 | ✅ | ✅ | `game.js`（client/server 共用純邏輯，`README.md` 技術棧） |
| 3D 棋盤（three.js CDN） | ✅ | ✅ | `index.html:78` |
| 2D Canvas 自動降級 | ✅ | ✅ | `index.html:12-13,76-78` |
| AI 對戰（三難度＝三規則集） | ✅ | ✅ | `README.md` 各模式規則對照 |
| 雙人同屏 | ✅ | ✅ | `index.html:193-196` |
| 落子分享／下載棋局圖 | ✅ | ✅ | `README.md` 介面元素 |
| 版號顯示 | 手動寫死 `v0.3.2`（`index.html:205`） | `/api/health` 動態版號（`online/ui.js:266`） | `index.html:205,247` |
| 入口「線上對戰」按鈕 | ❌ 永遠隱藏（預設 `hidden`） | ✅ 探測成功後顯示 | `index.html:197`；`online/ui.js:265-267` |
| 「單機模式」提示 | ✅ 顯示 | ❌ 不顯示 | `index.html:201`；`online/ui.js:269-273` |
| 線上對戰（房間／邀請連結／QR） | ❌ | ✅ | `README.md` 線上對戰表；`index.html:391` |
| 回合鐘／斷線重連寬限 | ❌ | ✅（60s／90s） | `server/config.js:15-16` |
| 座位 token 續戰 | ❌ | ✅ | `server/store.js:6`；`online/tokens.js` |
| 戰情中心（即時戰況） | ❌ | ✅ | `index.html:228`；`online/ui.js:270` |
| 觀戰（第三人以觀眾席加入） | ❌ | ✅ | `README.md` 座位系統 |
| 聊天室（限速／快速訊息） | ❌ | ✅ | `server/config.js:22-24` |
| 協商（和棋／提前結束／認輸／再來一局） | ❌ | ✅ | `README.md` 協商功能；`server/store.js:7` |
| 全站公告（強制閱讀＋已讀回條） | ❌ | ✅ | `README.md` 全站公告列 |
| SPA 深連結 `/r/:roomId`、`/online`、`/game` | ❌ | ✅ | `server/index.js:309-322`；`online/ui.js:275-305` |
| 管理後台 `/admin`（指標／公告／負載圖／IP 封鎖） | ❌ | ✅（Google 登入＋allowlist） | `server/index.js:334`；`server/auth.js:6-18` |
| 持久化 | 無 | Firestore TTL（finished 24h／未結束 7d） | `server/index.js:583-595`；`deploy.sh:54-59` |
| 水平擴展 | 不適用 | 單實例（`--max-instances 1`） | `deploy.sh:47-48` |

---

## 1.9 測試與品質邊界（章節收束）

測試範圍概況（檔案清單層級，細節見測試章節）：

| 測試層 | 檔案（`tests/`） | 檔案（`server/tests/`） |
|---|---|---|
| 前端／規則／E2E | `game.test.js`（規則）、`app.smoke.test.js`、`app3d.test.js`（3D）、`online.test.js`（通訊層）、`integration.test.js`（真實 HTTP＋WS）、`lobby-rules.test.js`（大廳） | `room.test.js`、`rooms` 行為（`timers.test.js` 計時、`chat.test.js`、`guards.test.js` 上行窄化）、`store.test.js`、`auth.test.js`、`admin-routes.test.js`、`announcements.test.js`、`metrics.test.js`、`ip-monitor.test.js` |

- 一律使用 Node 內建 `node --test`，入口 `npm test`（`package.json:6`）；無第三方測試框架。
- 平臺相關的關鍵測試主題：計時惰性判定（`timers.test.js` 對應 Cloud Run CPU throttling 鐵則）、伺服器行為（`room.test.js`）、整合測試走真實 HTTP＋WS（`tests/integration.test.js`）。

## 1.10 本章待校準項（遺留觀察）

| # | 觀察 | 影響 | 建議 |
|---|---|---|---|
| 1 | `index.html:12` canonical 與 OG/Twitter URL（`index.html:16,20,27`）仍指向 GitHub Pages 舊網域 `five-chess-game.gh.miniasp.com`，而正式主站已是 Cloud Run（`README.md:5-8`：舊網址已重導向） | 搜尋引擎權重指向非主站 | 後續版本將 canonical/OG 對齊 Cloud Run（或自訂網域 `gomoku.game.miniasp.com`） |
| 2 | `package-lock.json:2-3` metadata 版本停在 `0.1.0`，未隨 `package.json`（0.3.2）同步 | 無功能影響；版本稽核時有雜訊 | 版號遞增時一併 `npm install --package-lock-only` |
| 3 | PWA 資產已齊（圖示／theme-color）但無 manifest／service worker | 無法安裝至主畫面（僅 iOS 圖示） | 列為候選強化項，需符合「零 build」鐵則 |
| 4 | GitHub Pages 靜態站的 `?v=__ASSET_VER__` 無注入機制（僅為字面查詢字串，`index.html:57-59`） | 靜態站快取更新依賴瀏覽器策略 | 可接受（單機站內容變動由 GH Pages 部署週期決定） |

---

*本章完。下一章（02）將展開：系統架構與模組劃分（`game.js` 規則引擎、`server/*` 伺服器、`online/*` 前端線上層、WS 協定）。*