# 三、技術採用（Technology Stack & Adoption）

| 項目 | 內容 |
|---|---|
| 文件版本 | v1.0 |
| 撰寫日期 | 2026-08-29 |
| 產品名稱 | 五子棋 · Five Chess（Gomoku） |
| 對應產品版本 | v0.3.2（`package.json:3`） |
| 狀態 | 正式（Approved） |
| 資料來源 | 原始碼逐行核對（app.js／game.js／server/／admin.js／tests/）、`package-lock.json`、`Dockerfile`、`deploy.sh`、`AGENTS.md`、`README.md`、git 提交史 |

> 本章定義本專案「用了哪些技術、為什麼用它、以及明確不用什麼」。所有選型均附證據（檔案:行號），後續維護者與協作 Agent 在更換任何一項技術前，必須先理解該選項存在的理由（多數決策源自「前端零 build」與「server-authoritative」兩條架構鐵則，詳見 `AGENTS.md:49-53`）。

---

## 3.1 技術選型總表

| 層級 | 技術 | 版本 | 用途 | 選擇理由 | 替代方案（未採用） |
|---|---|---|---|---|---|
| 前端語言 | 原生 JavaScript（ES5 語法風格 + 選用 ES2015+ 標準函式庫） | —（語言層級，無編譯） | 全部前端邏輯 | 零 build、任何現代瀏覽器直接執行；`app.js`／`online/*.js` 全部使用 `var`＋函式宣告，僅使用 `Array.fill`、`String.padStart`、`Promise`、`fetch` 等標準內建 | TypeScript、Babel、任何需要編譯的方言 |
| 前端框架 | 無（原生 DOM API） | — | DOM 操作、事件、畫面路由 | 避免 React/Vue 的 runtime 與建置鏈；`app.js` 為 IIFE 模組直接操作 DOM（`app.js:1-11`） | React、Vue、Svelte、jQuery |
| 3D 渲染 | three.js（UMD 全域建置，unpkg CDN） | 0.160.0 | 3D 棋盤、棋子、燈光陰影、raycast 拾取 | r160 是**最後一版提供 UMD `three.min.js` 的版本**（r161 起官方移除該檔，實測 r161 回 404），正好符合零 build 的 `<script>` 全域載入 | Babylon.js、CSS 3D transform、WebGL 手寫 |
| 2D 備援渲染 | Canvas 2D API（瀏覽器原生） | — | three.js 無法載入時的完整備援渲染路徑 | 瀏覽器內建、零相依，確保「始終可玩」（`index.html:76-77`） | PixiJS、SVG |
| 規則引擎 | 自研 `game.js`（UMD 純函式模組） | — | 五子棋規則＋AI（client/server 共用） | server-authoritative 鐵則：同一份程式碼在瀏覽器與 Node 執行，規則判定零分歧（`game.js:1-11`、`AGENTS.md:49`） | 將邏輯寫在 client（違反 server-authoritative） |
| 前端樣式 | 原生 CSS + CSS 自訂屬性（variables） | — | 全部 UI 樣式 | 無框架、無預處理器（`styles.css:1-3`），零工具鏈 | Tailwind、Bootstrap、Sass/PostCSS |
| 字型／圖示 | 系統字型堆疊＋PNG/SVG favicon | — | 中文字型、圖示 | 不載入任何 webfont／icon library，零額外網路請求（`styles.css:16`） | Google Fonts、Font Awesome |
| QR Code | qrcode（npm 原始碼 esbuild 打包成瀏覽器 bundle） | 1.5.4 | 房間邀請連結 QR Code | 曾用 CDN，因「CDN 被牆／逾時導致 QR 不顯示」改為本機打包 24KB 檔（commit `f349283`），運行時零網路依賴 | CDN 載入、server 端生成圖片 |
| 圖表 | Chart.js（UMD 全家桶 bundle） | 4.4.7 | 管理後台負載曲線（每分鐘／每小時／每日） | 唯一成熟的無 build UMD 圖表庫；本地化 vendor 避免後台依賴 CDN（`assets/vendor/chart.umd.min.js:1-7` 檔頭） | D3（太重）、ECharts（體積大） |
| Google 登入 | Google Identity Services（GSI client，動態 `<script>` 載入） | 最新版（Google 託管） | 後台管理員登入 | 前端取得 ID token、後端驗 RS256 簽章，不需 OAuth 後端跳轉流程（`admin.js:117-147`） | passport-google-oauth、express-session + OAuth2 flow |
| 後端執行環境 | Node.js | 22（`node:22-slim`） | 對戰伺服器、靜態檔、WS | `@google-cloud/firestore@9` 要求 `node >= 22`；Cloud Run 原生支援 | Deno、Bun |
| Web 框架 | Express | 5.2.1 | 靜態檔託管、REST API、後台 API | 業界標準、中介層模型簡單；鎖 `^5.2.1`（`package.json:23`、`package-lock.json:704-705`） | Fastify、Koa、Hapi、裸 http |
| WebSocket | ws | 8.21.3 | `/ws` 即時對戰通道 | 事實標準、純函式庫、支援 `noServer` 手動 upgrade（`server/index.js:352`），適合需要自行攔截升級的場景 | socket.io（協定過重、非必要）、原生 uWebSockets |
| 資料庫 | Cloud Firestore（`@google-cloud/firestore`） | 9.0.0 | 房間與後台資料持久化 | Serverless 免維運、文件模型貼合「一房一文件」、原生 TTL 自動清理（`server/firestore-store.js:1-5`） | 自架 DB（Cloud Run 單實例架構下無意義）、Datastore |
| 房間狀態儲存介面 | 自製可插拔 `RoomStore`（InMemoryStore ↔ FirestoreStore） | — | 房間狀態持久化抽換 | 開機即用（in-memory）、上線即持久化，測試不碰網路（`server/store.js:1-31`） | Redis（多一個依賴服務） |
| 後台認證 | Google ID Token（RS256 + JWKS）＋ 自製 HMAC-SHA256 session cookie | — | `/admin` 管理員登入 | 「不引入外部相依」明文設計：Node 內建 `node:crypto` 自驅 JWKS 驗章與 HMAC session（`server/auth.js:2-6`） | express-session、passport、jsonwebtoken、firebase-auth |
| 測試框架 | node:test + node:assert（Node 內建） | Node 22 內建 | 全部測試（前端/E2E + 伺服器） | 零第三方測試套件、無 jsdom（`package.json:7-8`、`tests/game.test.js:4`） | Jest、Vitest、Mocha、Playwright |
| 容器／部署 | Docker（node:22-slim）→ Cloud Build → Cloud Run | — | 建置與部署 | `deploy.sh` 一鍵（gcloud CLI + Cloud Build 遠端建置），session-affinity 綁定 WS（`deploy.sh:39-51`） | Kubernetes、App Engine、手動 VM |
| CI/CD | 無（本機 `deploy.sh` 手動部署） | — | 發佈流程 | 專案無 `.github/workflows`，品質關卡為 commit 前 `npm test`（AGENTS.md 工作流） | GitHub Actions |
| TTL 清理 | Firestore TTL policy（`expireAt` 欄位） | — | 過期房間／IP 資料自動刪除 | 免寫排程器，Cloud Run 單實例下最省資源（`server/firestore-store.js:4-5`、`deploy.sh:54-57`） | Cloud Scheduler + cron 刪除 |

---

## 3.2 「前端零 build」原則專章

### 3.2.1 為什麼不引入 bundler／TypeScript／框架

1. **部署形態決定一切**：本專案同時部署在兩種靜態託管環境——GitHub Pages（`CNAME`）與 Cloud Run。GitHub Pages 上**沒有 Node 程序**可以跑任何建置後處理，所有檔案必須「原樣可用」。任何需要 build step 的方案（webpack/vite/tsc）都會讓「clone 下來直接開 `index.html`」的開發體驗消失。
2. **單一 HTML 入口的簡單性**：整個前端只有一份 `index.html`，載入 7 支原生 JS（`index.html:390-397`），總量小（app.js 56KB、game.js 46KB 量級），模組邊界用載入順序表達，不需要 bundler 解決的模組解析／tree-shaking／code-splitting 問題不存在。
3. **AI 協作友善**：Agent（Copilot CLI）直接讀改原生檔案即可生效，不需理解建置組態；測試也直接 `require()` 原始檔（`tests/game.test.js:10`）。引入 TypeScript 會切斷「原始碼＝執行檔」的等價性。
4. **官方鐵則**：「前端零 build：所有 JS/CSS 都是原生檔案直接載入（唯一的第三方資源 three.js / qrcode / Chart.js 以 `assets/vendor/` 或 CDN 載入），新增前端功能不得引入 bundler」（`AGENTS.md:51`）；`package.json:4` 的描述也明文「零依賴前端」。

### 3.2.2 原生檔案直接載入的具體做法

- **載入順序即依賴順序**（`index.html:390-397`，皆掛 `?v=__ASSET_VER__`）：
  1. `/game.js` — 規則引擎（UMD：Node 走 `module.exports`、瀏覽器掛 `window.Game`，`game.js:5-11`）
  2. `/assets/vendor/qrcode.min.js` — 掛 `window.QRCode`
  3. `/shared/protocol.js` — 掛 `window.Protocol`（UMD，`shared/protocol.js:6-11`）
  4. `/online/socket.js` → `/online/tokens.js` → `/online/session.js` — 依序掛 `window.ReconnectingSocket`／`OnlineTokens`／`OnlineSession`（`online/session.js:7-10` 有 module 偵測以便 Node 測試雙用）
  5. `/app.js` — 主控制器（IIFE + `"use strict"`，讀 `window.Game`，`app.js:6-8`）
  6. `/online/ui.js` — 線上 UI 黏合層
- **無 import/export**：所有前端模組都是 IIFE＋全域命名空間模式（`window.Game`／`window.Protocol`／`window.QRCode`／`window.THREE`），模組化靠「腳本載入順序」而非 import graph。
- **UMD 雙用慣例**：需要在 Node 測試的模組（`game.js`、`shared/protocol.js`、`online/socket.js`、`online/tokens.js`、`online/session.js`）一律採 `(function(root, factory){ ... module.exports / root.X = api })` UMD 包裝（`game.js:5-11`、`shared/protocol.js:6-11`），同一份檔案瀏覽器直接 `<script>`、Node 直接 `require()`。
- **CSS 同樣零 build**：單一 `styles.css`（36KB）＋ `admin.css`，原生 CSS 變數、無 preprocessor、無 minify pipeline（`styles.css:1-3`）。

### 3.2.3 第三方程式碼引入規範（vendor 本地化 vs CDN）

| 第三方 | 引入方式 | 證據 |
|---|---|---|
| three.js 0.160.0 | **CDN**（`https://unpkg.com/three@0.160.0/build/three.min.js`），因為它是「可缺席」的增強層（有 2D 備援） | `index.html:78` |
| qrcode 1.5.4 | **本地 vendor**：以 esbuild 把 `qrcode@1.5.4` browser 版打包成 `assets/vendor/qrcode.min.js`（24KB），因為等待對手頁的 QR **不可缺席**，曾被 CDN 逾時打掛過（commit `f349283`） | `assets/vendor/qrcode.min.js`、commit `f349283` |
| Chart.js 4.4.7 | **本地 vendor**：`assets/vendor/chart.umd.min.js`（自 jsdelivr `npm/chart.js@4.4.7/dist/chart.umd.js` 取得，檔頭註明出處），後台為內部工具但同樣不依賴 CDN | `assets/vendor/chart.umd.min.js:1-7`、`admin.html:144` |
| Google Identity Services | **CDN 動態載入**（`https://accounts.google.com/gsi/client`，登入時才注入 `<script>`） | `admin.js:118-127` |

規範要點：

- 判準是「**該功能缺席時，遊戲是否仍可玩**」。可缺席（3D 強化）→ 允許 CDN；不可缺席（QR、後台圖表）→ 本地 vendor。
- 所有 vendor 檔一律放 `assets/vendor/`、以 `<script src>` 原生載入、URL 掛 `?v=__ASSET_VER__`（`index.html:391`、`admin.html:144`）。
- vendor 檔必須保留版本線索：Chart.js 檔頭保留 jsdelivr 來源註解與 `Chart.js v4.4.7` 版本字樣（`assets/vendor/chart.umd.min.js:1-8`）；qrcode 為 esbuild 產物，版本對照 `package.json:24`（qrcode ^1.5.4）與 commit `f349283` 的說明。
- **升級 vendor 的程序**：更新 npm 套件 → 重新產生 vendor bundle → 驗證 `npm test` → commit。不得改為動態 CDN 注入（違反 3.2.1）。

### 3.2.4 three.js 的實際載入與 2D 備援機制

- `index.html` 於 `</head>` 前以同步 `<script>` 載入 unpkg 的 three.js UMD 全域建置（`index.html:76-78`），並附註釋：「three.js 是唯一的第三方資源，由 CDN 載入…若離線／被擋住時，頁面會自動改用 2D Canvas 渲染」。
- 備援判定點在 `buildView()`：`var use3D = typeof window.THREE !== "undefined"`（`app.js:532`）——script 載入失敗（離線、CDN 被牆、逾時）時 `window.THREE` 不存在，自動走 `make2DView()`，並以 `#gl`／`#fallback` 兩個 canvas 的 `display` 切換（`app.js:533-535`）、顯示提示文案「已切換 2D 模式（無法載入 3D 引擎）」（`app.js:541`）。
- **觸發條件的精確定義**：目前備援條件僅「script 未載入成功」；若 script 載入成功但裝置不支援 WebGL（`new THREE.WebGLRenderer` 丟例外），`buildView()` 無 try/catch 保護（`app.js:531-543`）——這是已知限制，規格上列為改良候選（見 §3.3.4）。
- 靜態託管（GitHub Pages）時 `?v=__ASSET_VER__` 佔位符只是普通查詢字串，不影響 CDN script 與 2D 備援（`index.html:64-65` 註釋）。

---

## 3.3 3D 渲染技術：three.js 使用範圍與 2D Canvas 備援

### 3.3.1 使用範圍（全部集中於 `app.js` 的 `make3DView()`，`app.js:127-407`）

| 類別 | 實際用法 | 證據 |
|---|---|---|
| Renderer | `THREE.WebGLRenderer({ antialias: true, alpha: true })`，pixelRatio 上限 2、`PCFSoftShadowMap` 陰影 | `app.js:131-134` |
| 相機 | `PerspectiveCamera(46, 1, 0.1, 100)`；自製 orbit（radius/theta/phi，`applyCam()` 手動算球座標 + `lookAt`），縮放以 `orbit.radius = 15 × 100/zoom%` 映射 | `app.js:137`、`194-207` |
| 燈光 | AmbientLight(0xffffff, 0.55) + 冷色 fill DirectionalLight(0.35) + 主 DirectionalLight(1.15, castShadow, 2048 shadow map, bias −0.0004) | `app.js:140-152` |
| 場景結構 | 棋盤 `BoxGeometry` 側板 + `PlaneGeometry` 頂面（1024px CanvasTexture 木紋，含棋線與星位）；棋子/標籤/勝局環分屬 `stones`／`labels`／`marks` 三個 `Group` | `app.js:153-175`、`380-407` |
| 材質 | `MeshStandardMaterial`（roughness/metalness PBR）：棋盤深木色、黑子 `0x1b1d24`、白子 `0xf3efe2`；棋子共用單一 `CylinderGeometry`（48 段）以省 draw call | `app.js:156-165`、`214-217` |
| 落子動畫 | 棋子自 y=6 落下的補間動畫（`animators` 陣列 + `userData.startY/targetY/t0`），落子序號以 128px Canvas 紋理貼 `PlaneGeometry` 標籤 | `app.js:223-236`、`241-259` |
| 標記 | 最後一手紅環 `TorusGeometry`（emissive）、懸停指示 `RingGeometry`、勝局高亮發光环 | `app.js:177-188`、`268-274` |
| 互動（raycast） | 滑鼠事件 → NDC → `THREE.Raycaster.setFromCamera` → `ray.intersectPlane(y=0 平面)` → `Math.round` 對齊格點（不用 mesh 求交，效能與穩定性最佳） | `app.js:283-298` |
| 縮放 | 使用者設定 30–130% 對應 orbit 半徑 15→8..60（`ZOOM_MIN/ZOOM_MAX`，`app.js:10`、`199-206`） | `app.js:10`、`199-207` |

### 3.3.2 2D Canvas 備援（`make2DView()`，`app.js:414-511`）

- 與 3D 共用同一組座標換算與回呼介面（`onPick`/`onZoom`/`place`/`markLast`/`markWin`/`showMoveNumbers`…），`buildView()` 之後的控制器完全不知道底下是 3D 還是 2D（`app.js:414-511`、`531-543`）。
- 每次狀態變更全量重繪（`draw()` → `layout()` 依 `devicePixelRatio` 設定實體像素，上限 2 倍，`app.js:420-431`）；棋子以 `createRadialGradient` 畫光澤，勝局高亮、最後一手紅圈、移動編號皆與 3D 版對齊（`app.js:433-505`）。
- 拾取不需 raycast：直接以 CSS 座標反算格點（`fromEvent`，`app.js:497-503`）。

### 3.3.3 兩個檢視的能力對照

| 能力 | 3D（three.js） | 2D Canvas |
|---|---|---|
| 拖曳旋轉視角 | 有（orbit theta/phi） | 無（固定俯視） |
| 捲輪縮放 | 有（orbit 半徑） | 有（cell 縮放重繪） |
| 落子動畫 | 重力落下補間 | 無（即時出現） |
| 陰影／PBR 光澤 | 有（2048 shadow map、金屬度） | 徑向漸層近似 |
| 進入條件 | `window.THREE` 存在 | 其餘一切情況 |

### 3.3.4 已知限制（規格層級的誠實聲明）

- 備援觸發條件**只**涵蓋「three.js script 載入失敗」；若載入成功但 WebGL context 建立失敗，`make3DView()` 內的 `new THREE.WebGLRenderer`（`app.js:131`）會丟例外且未被捕捉。此為已知改進點（build 路徑加 try/catch 降級 2D），現行版本未處理。
- 3D 路徑的測試以「THREE 偽件」覆蓋（`tests/app3d.test.js:1-9`），並非真實 WebGL；真實 WebGL 行為需人工煙霧測試。

---

## 3.4 後端技術：Node 22 + Express 5 + ws 8

### 3.4.1 Node 版本

- **正式映像 `node:22-slim`**（`Dockerfile:1`）；`package.json` **無 `engines` 欄位**，Node 22 的下限實際由兩件事背書：Dockerfile 基底映像（`Dockerfile:1`）與 `@google-cloud/firestore@9` 的 `engines: { node: ">=22" }`。
- 程式碼使用了 Node 22 的特徵：全域 `fetch`（`server/auth.js:49`）、`node:` 前綴內建模組（`server/auth.js:9`）、數字分隔符 `60_000`（`server/config.js:13`）、`server.closeAllConnections()`（`tests/integration.test.js:24`）。
- `package.json` 宣告 `"type": "commonjs"`（`package.json:5`），全案 CommonJS `require`，無 ESM。

### 3.4.2 Express 5.2.1 與中介層

- 依賴鎖 `^5.2.1`（`package.json:23`），鎖定解析 `5.2.1`（`package-lock.json:704-705`）。Express 5 為大版本升級（內建更嚴格的路由行為），是全案唯一 web 框架。
- 實際使用的中介層/組態（`server/index.js`）：
  - `app.set("trust proxy", true)`（`server/index.js:53`）——Cloud Run 在 Google Front End 終結 TLS，真實 IP 在 `X-Forwarded-For`。
  - 全域中介：負載指標記錄 + IP 流量記錄 + 封鎖檢查（豁免 `/admin`、`/api/admin`、健康檢查）（`server/index.js:97-108`）。
  - `express.json({ limit: "16kb" })`（`server/index.js:125`）——嚴格限縮上行 body。
  - `express.static` + 依 `?v` 有無分級快取標頭（有 → `immutable` 一年；無 → 3600 秒；HTML 一律 no-cache）（`server/index.js:339-346`）。
- **不用** express-session、cookie-parser、helmet、morgan 等任何額外中介層套件；cookie 解析、session、安全標頭皆為自製（`server/auth.js:135-152`）。

### 3.4.3 ws 8.21.3：手動 upgrade 與心跳

- `new WebSocket.Server({ noServer: true })`（`server/index.js:352`），在 `server.on("upgrade")` 手動攔：路徑必須是 `/ws` → 被封鎖 IP 直接以原始 HTTP 403 拒絕升級 → 才交 `wss.handleUpgrade`（`server/index.js:354-374`）。手動升級是 IP 封鎖能在「握手階段」拒絕的前提。
- 心跳：30s `ping`，未收到 `pong` 即 `terminate()`（`server/index.js:565-573`、`server/config.js:16-17`）——對抗 Cloud Run／代理砍靜默連線。
- 訊息一律 JSON 文字框架；進房間邏輯前先過 `guards.guardMessage` 白名窄化（未知 `t` 丟棄、逐欄位驗型截斷，`server/guards.js:1-30`）。
- WS 與 HTTP 同一個 `http.createServer(app)` port（`server/index.js:349-350`），Cloud Run 單服務同時供靜態檔、REST、WS。
- 部署面：Cloud Run 需 `--session-affinity` 讓 WS 綁定實例（`deploy.sh:43`），`--max-instances 1` 保證房間狀態單一權威（`deploy.sh:45`）。

---

## 3.5 資料層：Cloud Firestore 與 InMemoryStore

### 3.5.1 Firestore 的使用範圍

| 面向 | 內容 | 證據 |
|---|---|---|
| SDK | `@google-cloud/firestore` ^9.0.0（鎖定 9.0.0，engines 要求 Node ≥ 22） | `package.json:22`、`package-lock.json:18-19` |
| 憑證 | **Application Default Credentials（ADC）**——`new Firestore({ projectId })` 不帶 key 檔，於 Cloud Run 自動用服務預設身分；本機由 `gcloud auth` 的 ADC 支援 | `server/index.js:586`、`server/firestore-store.js:13-14` |
| rooms collection | 一房一文件（`rooms/{roomId}`）；`state`/`negotiation`/`chat` 序列化為 JSON 字串存（Firestore 不收 `undefined`）；`expireAt` 存 Date 供 TTL | `server/firestore-store.js:1-5`、`53-63` |
| TTL | `expireAt` 欄位 + collection 層 TTL policy：finished 房 24h、未結束房最後更新後 7 天；`deploy.sh` 以 `gcloud firestore fields ttls update expireAt --collection-group=rooms --enable-ttl` 啟用 | `server/firestore-store.js:4-5`、`server/config.js:27-28`、`deploy.sh:54-57` |
| 後台 collections | `announcements`、`metrics_hours`、`ip_hours`、`ip_blocks`、`ip_alerts`（公告歷史、指標小時彙總、IP 流量/封鎖/告警） | `server/firestore-admin.js:5`、`14-18` |
| 載入策略 | **惰性動態 require**：僅 `FIRESTORE_ENABLED` 時才 `require("./firestore-store.js")` 並實例化；初始化失敗自動退回 InMemoryStore（不讓部署因 Firestore 故障全滅） | `server/index.js:583-590`、`600-606` |
| 查詢設計 | `listActive` 只用單欄位 `status in [...]` 查詢（免複合索引），排序在記憶體做、上限 200 份 | `server/firestore-store.js:36-50` |

### 3.5.2 InMemoryStore 的取捨

- `store.js` 定義可插拔 `RoomStore` 介面（`load/save/delete/listActive/listAll`），InMemoryStore 以 `Map` 實作、deep-copy 防共享參照（`server/store.js:1-31`）。
- 取捨：本機開發（`npm run dev` = `FIRESTORE_ENABLED=0`，`package.json:10`）與測試（`process.env.FIRESTORE_ENABLED = "0"`，`server/tests/admin-routes.test.js:5`）完全不依賴 Firestore；代價是重啟即失憶，但正式機 `--max-instances 1` + Firestore 讓重啟可完整重建房間（`server/store.js:1-9` 的 RoomDoc 設計即為此）。

---

## 3.6 認證技術：Google OAuth（GSI）＋自製 HMAC session

**不使用 express-session、passport、jsonwebtoken**——後台認證是「零相依」的自製實作（`server/auth.js:2-3`：「不引入外部相依」）。

1. **前端登入**：admin 頁動態載入 `https://accounts.google.com/gsi/client`，以 `GOOGLE_CLIENT_ID`（由公開端點 `GET /api/admin/config` 提供）`google.accounts.id.initialize` + `renderButton`（`admin.js:117-147`、`server/index.js:150-153`）。OAuth client 的授權來源必須含正式機網域（`README.md`「部署注意」）。
2. **後端驗章**：前端把 Google ID token（credential）POST 到 `/api/admin/google`（`admin.js:154-160`、`server/index.js:155`）；伺服器**不引入 JWT 套件**，用 Node 內建 `node:crypto` 完成：拆 JWT 三段 → `RS256` + `kid` 檢查 → 從 `https://www.googleapis.com/oauth2/v3/certs` 抓 JWKS（快取 1 小時，`server/auth.js:32-51`）→ `crypto.createPublicKey`（JWK 格式）+ `RSA-SHA256` 驗章（`server/auth.js:88-95`）→ 驗 `iss`/`aud`/`exp`/`email_verified` → 比對 `ADMIN_EMAILS` allowlist（`server/auth.js:96-105`、`10-24`）。JWKS 抓取以 Node 22 內建全域 `fetch` 完成（`server/auth.js:49`）。
3. **Session**：自製 `body.mac` 格式——`base64url(JSON{email,exp})` + `.` + `HMAC-SHA256(ADMIN_SESSION_SECRET)`，比對用 `crypto.timingSafeEqual` 防時序攻擊（`server/auth.js:104-127`）；cookie 屬性 `HttpOnly; Secure; SameSite=Lax`、TTL 12 小時（`server/auth.js:11`、`143-148`）。
4. **金鑰管理**：`ADMIN_SESSION_SECRET` 未設時以 `crypto.randomBytes(32)` 亂數產生 → 重啟即全員登出（對小後台可接受，正式機應設固定值）（`server/auth.js:7`、`155-157`、`server/index.js:55-56`、`deploy.sh:8-20` 的「沿用正式機現值」邏輯就是為了不把它洗掉）。

---

## 3.7 測試技術：node:test ＋ 手工偽件（無 jsdom、無第三方測試庫）

- **框架**：Node 內建 `node:test` + `node:assert(/strict)`，**零第三方測試套件**（`package.json:7-8`、`tests/game.test.js:4`）。指令：`npm test`（`node --test tests/*.test.js server/tests/*.test.js`）、`npm run coverage`（`--experimental-test-coverage`）。
- **前端/E2E 在無瀏覽器環境下的測法——不用 jsdom**，各檔頂部註明做法：
  | 檔案 | 做法 |
  |---|---|
  | `tests/game.test.js` | 純邏輯單元測試，直接 `require("../game.js")`（`檔頭 1-6`） |
  | `tests/app.smoke.test.js` | **手工打造最小 DOM 偽件**（`makeEl`/`makeCanvas` 假 2D context），讓**真正的 app.js** 走 2D 備援路徑跑落子/AI/undo/勝負流程（`檔頭 1-7`、`13-100`） |
  | `tests/app3d.test.js` | **手工打造極簡 THREE stub**（WebGLRenderer/Scene/Mesh/Raycaster… 空實作），讓真正的 app.js 走 3D 分支執行一幀動畫，覆蓋拾取與動畫路徑（`檔頭 1-7`、`15-100`） |
  | `tests/integration.test.js` | **真實 HTTP + WS**：`createServer()` 起真伺服器（InMemoryStore），用 `ws` client 跑完整對局（`1-38`） |
  | `tests/online.test.js` | 客戶端通訊層：直接 `require` UMD 模組測重連退避／seq／deadline 時鐘偏移（`檔頭 1-8`） |
  | `server/tests/*.test.js`（11 檔） | 伺服器行為測試以 `opts` 注入 store/secret/emails（`server/index.js:56-61` 的注入點專為測試設計）；auth 測試以**本機 RSA keypair 自簽 ID token、`fetchCerts` 注入**，完全不連外（`server/tests/auth.test.js:1-7`）；統一 `process.env.FIRESTORE_ENABLED = "0"` |
- **CI/CD**：**無**（無 `.github/workflows/`），品質關卡是本機 `npm test`（AGENTS.md:7）＋部署後 `curl /api/health` 驗版號（`deploy.sh:61-63`）。
- 本機純靜態預覽用 `npx --yes serve`（`package.json:9`），不列入依賴。

---

## 3.8 前端 UI 技術

| 技術 | 內容 | 證據 |
|---|---|---|
| CSS 架構 | 純 CSS，**無框架、無預處理器、無圖示庫**（檔頭明文）；主題以 `:root` CSS 變數集中定義（`--bg-0/--accent/--panel…`） | `styles.css:1-15` |
| 字型 | 系統字型堆疊 `"PingFang TC","Noto Sans TC","Microsoft JhengHei",…`，**不載入任何 webfont** | `styles.css:16` |
| 圖示 | 無 icon library；favicon 一組 PNG（16/32/48/192/512）＋apple-touch-icon，後台用內嵌 SVG data URI | `index.html:67-73`、`admin.html:8` |
| 分享圖 | 落子截圖/合成 PNG，走 `navigator.share`／`canvas.toBlob`（含 fallback） | `app.js:777-865` |
| QR Code | `window.QRCode.toCanvas(canvas, url, {width:168, margin:2, color:{...}})`；程式庫未載入時直接隱藏 QR 區塊（不影響流程） | `online/ui.js:1336-1355` |
| 圖表 | Chart.js 4.4.7 line chart：三種時間粒度（分/時/日）負載曲線，多軸（左軸人數、右軸 ms、右軸 CPU%），`Chart.register(Chart.registerables)` 預註冊、已有圖表原地 `update()` 不重建 instance；Chart 物件不存在時整段優雅跳過 | `admin.js:10-11`、`328-404`、`admin.html:64/75/90` |
| 圖表資料流 | `fetch` + `credentials: "same-origin"` 打 `/api/admin/metrics/series`，前台僅做渲染 | `admin.js:61-68`、`406-441` |

---

## 3.9 版本管理與相容性策略

### 3.9.1 資產快取與版本戳：`?v=__ASSET_VER__`

- `index.html`／`admin.html` 的每個本地 JS/CSS 引用都掛 `?v=__ASSET_VER__` 佔位符（`index.html:74`、`390-397`；`admin.html:143-145`）；伺服器送出 HTML 時以正則替換成「檔案內容 sha1 前 8 碼」——內容變 → URL 變 → 瀏覽器自動抓新版（`server/index.js:76-89`；`AGENTS.md:52`）。
- 配套快取分級：HTML `no-cache`；帶 `?v` 的靜態檔 `public, max-age=31536000, immutable`；未帶 `?v` 一小時（`server/index.js:339-346`）。
- 檔案不存在時 fallback 回套件版號（`server/index.js:83-84`），純靜態託管（GitHub Pages）時佔位符只是無害查詢字串（`index.html:64-66` 註釋）。
- **規範**：新增前端檔案也必須掛 `?v=__ASSET_VER__`（`AGENTS.md:52`）。

### 3.9.2 版號

- 單一來源 `package.json` `version`（0.3.2，`package.json:3`）→ `server/config.js:33` 讀取 → `GET /api/health` 公開（`server/index.js:114`）；首頁入口 `.entry-version` 為**手動同步的寫死字串** `v0.3.2`（`index.html:205`、`247`；AGENTS.md:36-38 規定每次 commit 同步遞增）。

### 3.9.3 協定相容

- WS 訊息型別集中在 `shared/protocol.js`（UMD，client/server 同檔共用；訊息以 `{t: ...}` 判別，上行白名窄化、未知 `t` 一律丟棄）（`shared/protocol.js:1-11`、`server/guards.js:1-3`）。
- 持久化文件帶 `version` 欄位（現行 `1`），讀取時不符即跳過（`server/store.js:2`、`server/firestore-store.js:46`）——這是資料層的向前相容機制。
- 回合計時以 deadline 時間戳惰性判定、setTimeout 僅輔助（`server/config.js:1-3`、`AGENTS.md:50`），確保 Cloud Run CPU throttling 下時間語意正確。

### 3.9.4 瀏覽器支援範圍（從程式碼特徵判斷）

- **語法層**：前端全部 ES5 語法（`var`/`function`；`app.js` 無 `const`/`let`/arrow/template literal——grep 驗證為零），最大化相容並利於老舊行動裝置。
- **標準庫層**：使用 ES2015+ 方法 `Array.prototype.fill`（`game.js:23`）、`String.padStart`（`app.js:454`）、`Promise`、`Map/Set`；後台使用 `fetch` + `Object.assign`（`admin.js:61-68`）。
- **平台 API**：Canvas 2D、WebGL（可缺席）、Pointer Events、WebSocket、localStorage、`navigator.clipboard`、`devicePixelRatio`、History API（戰情中心路由）。
- **結論**：支援「全體 evergreen 瀏覽器」（Chrome/Edge/Firefox/Safari 近年版本與現代行動裝置）；不支援 IE11（`fetch`、`padStart` 皆 IE 缺席）。伺服器端要求 Node ≥ 22（Dockerfile + Firestore SDK engines）。
- three.js 鎖 0.160.0 兼具相容意義：r161 起官方移除 UMD `three.min.js`（實測 r161 → 404），升版必須改用 module build，會破壞零 build 載入方式。

---

## 3.10 禁止事項（Forbidden Practices）

以下為明文或由架構鐵則推導的禁令（來源：`AGENTS.md`「架構鐵則」、`README.md` 技術棧、本規格）：

| # | 禁止事項 | 來源證據 |
|---|---|---|
| 1 | **不得引入前端 bundler／建置步驟**（webpack、vite、esbuild 管線、tsc 等）；所有 JS/CSS 必須是原生檔案直接載入 | `AGENTS.md:51`「新增前端功能不得引入 bundler」 |
| 2 | **不得引入前端框架**（React/Vue/Svelte/jQuery 等）——由「零 build + 原生檔案直接載入」鐵則推導；UI 一律原生 DOM + 原生 CSS | `AGENTS.md:3,51`；`styles.css:1-3` |
| 3 | **不得引入 TypeScript／CSS 預處理器／CSS 框架** | 同上推導；`styles.css:1-3`「無框架、無預處理器、無圖示庫」 |
| 4 | **game.js 必須維持純函式、零 DOM 依賴**（UMD，client/server 共用）——不得在規則引擎內觸碰 DOM/three.js/網路 | `AGENTS.md:49`；`game.js:2-3` |
| 5 | **不得讓前端引入新的第三方資源**而不遵循 vendor 規範：可缺席者走 CDN、不可缺席者本地化到 `assets/vendor/`；新檔案必須掛 `?v=__ASSET_VER__` | `AGENTS.md:51-52`；`index.js:76-89` |
| 6 | **不得引入 express-session／passport／JWT 套件**取代自製 HMAC session（後台認證刻意零外部相依） | `server/auth.js:2-3` |
| 7 | **不得引入第三方程式碼到 game.js／shared/protocol.js**（client/server 共用層必須保持零依賴） | `game.js:2-3`、`shared/protocol.js:2-3` |
| 8 | **不得引入第三方測試框架**（jest/vitest/jsdom/playwright）——一律 node:test ＋ 手工偽件 | `package.json:7-8`、`tests/game.test.js:4-6` |
| 9 | **不得引入前端建置相關 devDependencies**——`package.json` 的 devDependencies 必須保持為空 | `package.json:21-26`（僅 dependencies 四件） |
| 10 | 計時不得依賴 setTimeout 為真相來源（Cloud Run CPU throttling）——一律 deadline 時間戳惰性判定 | `server/config.js:1-3`、`AGENTS.md:50` |

---

## 3.11 依賴清單完整表

### 3.11.1 npm dependencies（正式依賴，共 4 件；無 devDependencies）

| 套件 | 版本（宣告 / 鎖定） | 層級 | 用途 | 為何需要 | 證據 |
|---|---|---|---|---|---|
| `express` | `^5.2.1` / 5.2.1 | HTTP 框架 | 靜態檔託管、REST API（health/games/rooms/admin）、SPA 路由、中介層（trust proxy、json 16kb、static 快取分級） | 唯一的 HTTP 層；Express 5 內建較嚴謹的 promise 錯誤語意，且團隊熟悉 | `package.json:23`、`package-lock.json:704-705`、`server/index.js:16,53,125,339` |
| `ws` | `^8.21.3` | WebSocket | `/ws` 即時對戰通道（noServer 手動 upgrade、心跳、踢線） | 線上對戰即時雙向通訊；純 WS 協定（無 socket.io 的額外層），client 端用瀏覽器原生 WebSocket，兩端只講自訂 JSON 協定 | `package.json:25`、`package-lock.json:2399-2400`、`server/index.js:17,352-374` |
| `@google-cloud/firestore` | `^9.0.0` | 資料庫 SDK | rooms 持久化（TTL）＋後台資料（公告/指標/IP 監控）五個 collection | 正式環境的持久化層；要求 Node ≥ 22；以 Application Default Credentials 連線（Cloud Run 服務帳戶，免金鑰檔） | `package.json:22`、`server/firestore-store.js:13-16`、`server/firestore-admin.js:12-18` |
| `qrcode` | `^1.5.4` | QR 生成（原始碼用途） | **唯一用途是作為 esbuild 打包 `assets/vendor/qrcode.min.js`（browser 版，24KB）的來源**，執行時期不被 require | 邀請連結 QR 不可依賴 CDN（曾因 CDN 逾時不顯示，commit `f349283`）；保留 npm 依賴是為了可重現地重打包 vendor 檔 | `package.json:24`、`assets/vendor/qrcode.min.js`、commit `f349283` |

### 3.11.2 執行時期其他技術來源（非 npm）

| 技術 | 版本 | 來源 | 用途 | 證據 |
|---|---|---|---|---|
| three.js | 0.160.0 | unpkg CDN（唯一 CDN 資源） | 3D 渲染 | `index.html:76-78` |
| Chart.js | 4.4.7 | `assets/vendor/chart.umd.min.js`（jsdelivr UMD 全家桶，含預註冊 registerables） | 後台負載圖表 | vendor 檔頭 1-8 行、`admin.html:144`、`admin.js:10-11` |
| qrcode（瀏覽器版） | 1.5.4 | `assets/vendor/qrcode.min.js`（esbuild 打包） | 房間邀請 QR | `index.html:391`、`online/ui.js:1336-1355` |
| Google Identity Services | 由 Google 託管 | `https://accounts.google.com/gsi/client`（登入時動態注入） | 後台 Google 登入按鈕與 ID token | `admin.js:117-127` |
| `serve`（僅開發） | npx 臨時 | `npx --yes serve` | 純靜態本機預覽，非依賴 | `package.json:9` |

### 3.11.3 間接依賴與體積

- 鎖定檔共 212 個套件（`package-lock.json`），絕大多數來自 `@google-cloud/firestore` 的傳遞依賴（google-gax、google-auth-library 等）；`express` 與 `ws` 的傳遞面很小。
- **鎖定策略**：semver 範圍（`^`）+ `package-lock.json`；Docker 映像以 `npm install --omit=dev` 安裝（注意：**是 `npm install` 而非 `npm ci`**，依賴 Docker layer 快取，`Dockerfile:6-7`）。
- `@google-cloud/firestore` 為惰性載入（`FIRESTORE_ENABLED` 才 require，`server/index.js:583-606`），測試與 `npm run dev` 完全不觸碰它。

### 3.11.4 工具鏈（非 npm 依賴）

| 工具 | 用途 | 證據 |
|---|---|---|
| Docker（node:22-slim 基底） | 生產映像；ENV：`NODE_ENV=production`、`FIRESTORE_ENABLED=1` | `Dockerfile:1,17-21` |
| Cloud Build | `gcloud run deploy --source .` 觸發遠端建置（本機不需 Docker daemon） | `deploy.sh:39-51` |
| gcloud CLI | 部署、啟用 API（run/firestore/cloudbuild）、設定 Firestore TTL、部署後驗證 | `deploy.sh:30-58` |
| esbuild（一次性） | 當初打包 qrcode browser bundle 用（非專案依賴） | commit `f349283` 說明 |
| node:test / node:assert | 測試（Node 內建） | `package.json:7-8` |

---

## 3.12 摘要：一句話技術畫像

> **一個把「零建置」貫徹到極端的專案**：前端是 ES5 語法的原生 JS＋原生 CSS，唯一的外部引擎 three.js 鎖在最後一版提供 UMD 的 0.160.0 走 CDN，且任何第三方缺席都有降級路徑（3D→2D、QR 隱藏、圖表跳過）；後端刻意只用四個 npm 套件（express、ws、@google-cloud/firestore、qrcode），連 session、JWT 驗章、IP 監控、指標都手刻；測試不用任何第三方框架，以 node:test ＋手工 DOM/THREE 偽件與真實 HTTP+WS 整合測試覆蓋——一切取捨都服務於「免建置、可降級、單機可玩、單實例可營運」四個目標。

---

*證據以「檔案:行號」標註於各表格與段落；版本快照以 v0.3.2（commit `a8a85ed` 之後的工作樹）為準。*