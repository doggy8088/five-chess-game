# 六、設計決策與脈絡溯源（Design Decisions & Provenance）

| 項目 | 內容 |
|---|---|
| 文件版本 | v1.0 |
| 撰寫日期 | 2026-08-29 |
| 產品名稱 | 五子棋 · Five Chess（Gomoku） |
| 版本 | v0.3.2 |
| 狀態 | 正式（Approved） |
| 資料來源 | GitHub Copilot CLI session log（cloud + local session store）、git 完整提交史、原始移植提示詞文件、原始碼 |

> 本章記錄「每一個重大設計決策是怎麼來的」：當初的使用者提示詞（原文引用）、AI 的最終決策、以及後續的演進與偏離。目的在於讓未來的維護者與協作 Agent 能理解「為什麼長這樣」，避免無意識地破壞既有設計。

---

## 6.1 考古方法與資料來源

本文件的證據來自四個管道，互相交叉驗證：

| # | 管道 | 內容 | 可信度 |
|---|---|---|---|
| 1 | **原始移植規格提示詞** | `~/.copilot/session-state/597bfb0b-05e0-4570-912d-6ab55d6cbe10/files/online-multiplayer-porting-prompt.md`（31KB，2026-08-28 01:03）——使用者將「台灣暗棋（doggy8088/dark-chess）」的完整線上系統規格整理成移植提示詞，貼給本專案要求照做 | 最高（原文文件） |
| 2 | **Copilot CLI session log** | 透過 session store 查得的 17+ 個 session（2026-08-15 ～ 2026-08-28），包含使用者逐字提示詞與時間軸 | 高（原文） |
| 3 | **Git 提交史** | 65 個 commit，全部為繁體中文詳細 log（使用者明文要求），是功能演進的權威記錄 | 最高 |
| 4 | **原始碼現況** | 以程式碼驗證決策是否仍成立 | 最高 |

---

## 6.2 專案發展時間軸（由 git log 與 session 記錄重建）

| 日期 | 里程碑 | 來源 |
|---|---|---|
| 2026-08-15 10:31 | 專案誕生：3D 網頁五子棋（three.js）Initial commit + CNAME（GitHub Pages 自訂網域 `five-chess-game.gh.miniasp.com`） | `baf8acf`、`45b7033` |
| 2026-08-15 下午 | 加入 SEO/OpenGraph/Twitter Card/JSON-LD（session `4ebe57f2`），並為日文搜尋調整標題關鍵字（`3479469`、`a3f666a`） | git + session `4ebe57f2` |
| 2026-08-15 晚間 | **禁手規則三部曲**：使用者先口頭描述「雙活三」規則（session `3bfb7b73`），再貼上完整禁手規則文件（session `42f213a2`），最終實作三三・四四・長連三大禁手與「精準五連」勝負（`372e631`、`7e00499`） | git + session |
| 2026-08-15 深夜 | **規則集與 AI 難度綁定**的決策成形：簡單＝自由規則（`16eef69`）、中等＝標準無禁（`85a9d07`）、困難＝日規／國際連珠（`a9aed62`） | git |
| 2026-08-16 | AI 棋力強化（樣式評估、VCF 連續衝四殺，session `8421481e`/`d3d87e0e`）、手機版控制列收合（session `67b05c22`）、撤銷依難度設限、棋局結果分享 | git |
| 2026-08-17～18 | 結果圖片下載（session `3fc08ff4`）、桌面版控制列收合、中途分享、執黑／執白陣營選擇（`11bf5cb`） | git |
| 2026-08-27 17:05 | **線上對戰系統移植**：使用者提出「我希望能加入即時連線對戰功能，網站要發佈到 Cloud Runs，部署到 vertex-ai-sprint 專案中」，並附上移植提示詞文件（session `8f4f2ec5`，cloud）→ 一次大型移植 commit `476b1a2`（2026-08-28 03:40） | session + git |
| 2026-08-28 凌晨 | 移植收尾：HUD 重建、QR Code 本機化（`f349283`）、資產版本改為伺服器內容雜湊注入（`bfed09d`）、聊天抽屜拖曳、快速訊息擴充至 24 句 | git |
| 2026-08-28 上午 | **管理後台移植**（fleet 任務，session `cfe556e4`）：「幫我實作一個後台，所有設定都要跟 /Users/will/demo/dark-chess 的實作差不多…」→ `71dd872`（核心模組：認證／指標／IP 監控／公告）＋ `b26f542`（API 路由 + admin.html/js/css） | session + git |
| 2026-08-28 10:12 | 使用者訂立工作流規則：「記得每次更新都要 commit with full detailed zh-tw log 與變更版本號，還要順便部署 cloud runs，請寫入 AGENTS.md 備忘一下」→ `08f5e9c` | session + git |
| 2026-08-28 下午 | 戰情中心版位迭代：先移到入口首頁底部（`6f74bf0`，因使用者要求「擺在首頁下方」）→ 再移回重新設計的線上大廳並加入 History API 瀏覽記錄（`98b10df`）→ 「開始遊戲」也加入 History API（`223f03f`）→ 大廳 Footer 統一為 Copyright + 版號（`a8a85ed`） | session + git |
| 2026-08-28 | 部署穩定性修正：`deploy.sh` 未帶後台環境變數時自動沿用正式機現值，避免 `ADMIN_SESSION_SECRET` 每次部署被清空（`9cf5c12`） | git |

**結論**：本專案是「兩段式演進」——先做單機 3D 五子棋（08-15～08-19），再以移植提示詞 + dark-chess 範本一口氣補上線上對戰與管理後台（08-27～08-28）。

---

## 6.3 當初的提示詞（原文節錄）

### 6.3.1 線上對戰移植（session `8f4f2ec5`，2026-08-27）

> 「我希望能加入即時連線對戰功能，網站要發佈到 Cloud Runs，部署到 vertex-ai-sprint 專案中。
> Follow the spec to implement: `/Users/will/.copilot/session-state/597bfb0b-05e0-4570-912d-6ab55d6cbe10/files/online-multiplayer-porting-prompt.md`」

該移植提示詞文件自述來源為 **dark-chess 的實際線上系統**，開頭即訂下五大鐵則（原文節錄）：

1. **Server-authoritative**：所有遊戲狀態只有伺服器那一份是權威。客戶端只是「送出意圖（action）→ 收到結果 → 播動畫」。規則引擎必須是**純函式、零 DOM 依賴**，讓 client 與 server **共用同一份程式碼**。
2. **隱藏資訊絕不出伺服器**（redactState 鐵則）。
3. **計時以 deadline 時間戳惰性判定**：不用 setTimeout 當真相…在 Cloud Run CPU throttling 下計時器不可靠。
4. **WebSocket 自動重連是正常流程，不是錯誤處理**。重連後重送 `join` 即可無縫復原。
5. **斷線不等於離開**：座位憑 `playerToken` 認領，同一網址隨時回來續戰。

### 6.3.2 管理後台（fleet 任務，session `cfe556e4`，2026-08-28）

> 「幫我實作一個後台，所有設定都要跟 /Users/will/demo/dark-chess 的實作差不多，請參考 dark-chess 的後台實作規格下去製作，但要對 gomoku 的遊戲屬性做出一些變化（如果有需要的話）。首頁一樣要有『即時戰況』的區塊於下方（Footer 之前），功能規格可以參考 dark-chess」

### 6.3.3 工作流規則（session `cfe556e4`，2026-08-28 10:12）

> 「記得每次更新都要 commit with full detailed zh-tw log 與變更版本號，還要順便部署 cloud runs，請寫入 AGENTS.md 備忘一下」

這條提示詞後來成為 `AGENTS.md` 的鐵則：**每次 commit 必須（1）繁中詳細 log、（2）遞增版號、（3）部署 Cloud Run 並驗證健康端點**。

### 6.3.4 禁手規則（sessions `3bfb7b73`、`42f213a2`，2026-08-15）

> 「五子棋好像有一些規則，先手黑棋不能做雙活三之類的，請幫我加入這條規則，當有雙活三的時候，記得要給予一次機會退回，如果當局再犯就直接判輸」

下一個 session 使用者直接貼上完整規則文件（三三／四四／長連、白棋無禁手、先五為勝），成為三大禁手的實作依據（`7e00499`）。

### 6.3.5 AI 棋力（sessions `d3d87e0e`、`8421481e`）

> 「我想要特別加強『困難』等級時對戰 AI 的棋力，用更厲害的策略與人類對奕！」

衍生出威脅感知搜索（`89a931b`）、樣式評估與必殺威脅攻防（`50a43cd`）、VCF 連續衝四殺（`3f8792f`）三次 AI 迭代。

---

## 6.4 關鍵決策與理由（提示詞 → 決策 → 現況驗證）

| # | 決策 | 當初脈絡 | 最終決策 | 現況驗證 |
|---|---|---|---|---|
| D1 | **Server-authoritative + 三端共用純函式規則引擎** | 移植提示詞 §0 鐵則 1 | 採用。`game.js` 為零 DOM 純函式，client（單機＋線上）與 server 共用同一檔；型別/協定集中在 `shared/protocol.js` | `game.js`、`shared/protocol.js` 同時被 `tests/` 與 `server/tests/` 載入 |
| D2 | **計時以 deadline 惰性判定** | 移植提示詞 §0-3、§4：Cloud Run CPU throttling 下 setTimeout 不可靠；`setTimeout` 只當 nudge 且 `.unref()` | 照辦：`room.js` 的 `evaluate()` 在每則訊息／連線／載入時結算過期 deadline | `AGENTS.md` 架構鐵則明文記載 |
| D3 | **`/api/health` 探測決定功能顯示** | 移植提示詞 §1：探測成功才顯示「線上對戰」按鈕；純靜態站（GitHub Pages）自動隱藏整個線上功能 | 成為單一程式碼同時支援「GitHub Pages 單機版」與「Cloud Run 線上版」雙部署的關鍵機制 | `online/ui.js` probeHealth()；離線時顯示 `#entry-offline-note` |
| D4 | **前端零 build（對移植提示詞的重大改編）** | 提示詞原本假設「Vite SPA + TypeScript + `vite.config.ts` proxy」 | 本專案既有程式碼是**零 build 原生 JS**，移植時將 TS 型別改寫為 `shared/protocol.js`（JSDoc 風格註解），放棄 bundler；AGENTS.md 事後明文禁止引入 bundler | `index.html` 直接 `<script>` 原生檔；`shared/protocol.js` 無 TS |
| D5 | **redact／fairness（commit–reveal）在 gomoku 省略** | 移植提示詞 §0-2、§10（源自暗棋的隱藏資訊需求） | 五子棋無隱藏資訊，`redact.ts`／`fairness.ts` 判定為 N/A 而未移植（原始碼無 `redact.js`、無 fairness 模組）；提示詞本身也註明「若目標遊戲沒有隱藏資訊，此節可省略」 | `grep redact|fairness` 於 `shared/`、`server/` 無結果 |
| D6 | **房間＝邀請連結制＋playerToken 認領座位** | 移植提示詞 §2：`/r/{roomId}` 為唯一入場憑證、無歧義 base32 房號、token 認領座位、connected-elsewhere 踢多開 | 照辦（`server/ids.js`、`online/tokens.js`、`/r/:roomId` 路由） | `server/ids.js`、`online/tokens.js` |
| D7 | **戰情中心版位的三次迭代** | 使用者三度調整：①先在線上層內（移植預設）→ ②「從首頁進入線上對戰才出現戰情中心是錯誤的，我希望擺在首頁下方」（session `cfe556e4` turn 3）→ ③「幫我把戰情中心從首頁移到…『線上對戰』的那一頁，那一頁請重新設計」＋ History API 返回（turn 4） | 最終：線上大廳（`#screen-home`）內、Footer 之前；入口首頁與大廳皆有 History API 瀏覽記錄，瀏覽器上一頁可返回 | `6f74bf0`→`98b10df`→`223f03f`；`bootRoute()` 支援 `/online` 深連結 |
| D8 | **管理後台 = dark-chess 後台的同構移植** | session `cfe556e4`：「所有設定都要跟 dark-chess 的實作差不多…對 gomoku 的遊戲屬性做出一些變化」 | 模組對位：Google OAuth + ADMIN_EMAILS allowlist、HMAC session（`ADMIN_SESSION_SECRET`）、指標（metrics.js + Chart.js）、IP 異常告警（ip-monitor.js + `IP_ALERT_*`）、公告（announcements.js） | `server/auth.js`、`server/metrics.js`、`server/ip-monitor.js`、`admin.html` |
| D9 | **工作流鐵則寫入 AGENTS.md** | 使用者明示要求（6.3.3） | 版號必遞增（package.json + index.html 入口頁手動同步）、zh-TW 詳細 commit log、commit 後必部署 Cloud Run 並 curl 驗證 | `AGENTS.md`、`08f5e9c` |
| D10 | **資產快取策略改為伺服器內容雜湊** | 手工版本戳屢次失效（`d5d95d2` 之後仍發生 JS/CSS 快取問題） | 改為伺服器對 JS/CSS 內容做 sha1（前 8 碼）於請求時注入 `?v=__ASSET_VER__`（`bfed09d`） | `index.html`、`server/index.js` |
| D11 | **第三方資源本地化** | 等待頁 QR Code 原依賴 CDN（session 記錄「分享功能」討論後的可靠性要求） | qrcode 改本機打包（`f349283`）；three.js 以 `assets/vendor/` 本地優先＋CDN 備援；AGENTS.md 明列三.js/qrcode/Chart.js 為唯一第三方 | `assets/vendor/` |
| D12 | **規則集 × AI 難度綁定** | 使用者先要求加禁手（6.3.4），再演變為三難度對應三規則集 | 簡單＝自由（無禁手）、中等＝標準（僅精準五連）、困難＝連珠（禁手）；同一份 `game.js` 引擎以參數切換，線上房間沿用同三種規則集 | `16eef69`/`85a9d07`/`a9aed62`、`online/ui.js` ruleset-seg |
| D13 | **雙部署平臺** | 單機玩法希望零後端可玩（GitHub Pages），線上對戰需 WS（Cloud Run） | CNAME（`45b7033`）+ `/api/health` 探測（D3）構成「一份程式碼、兩種部署」 | `CNAME`、`deploy.sh` |
| D14 | **快速訊息在地化擴充** | 移植提示詞為 12 句；使用者要求擴充 | 擴充至 **24 句**（含 Emoji 與嗆聲垃圾話），改單排左右滑動（`74a65f9`） | `online/ui.js` CANNED |

---

## 6.4 對移植提示詞的適配差異總表

移植提示詞（來源 dark-chess）與本專案最終實作的差異，是有意識的適配而非遺漏：

| 移植提示詞假設 | gomoku 最終實作 | 原因 |
|---|---|---|
| Vite SPA + TypeScript + `src/shared/protocol.ts` | 前端零 build、原生 JS、`shared/protocol.js` | 專案鐵則：前端零 build（AGENTS.md），既有程式即原生檔案 |
| `redactState()` 隱藏資訊鐵則 | 不需要（無 redact 模組） | 五子棋無隱藏資訊，§10 fairness（commit–reveal）一併省略 |
| `fairnessHash` / `fairnessReveal` 訊息 | 不存在於 gomoku 協定 | 同上 |
| 快速訊息 12 句 | 24 句（單排左右滑動 chips） | 使用者後續需求（`74a65f9`） |
| 版號 build 時 `--define:__APP_VERSION__` 注入 | `package.json` → `server/config.js` → `/api/health` 公開；入口頁 `.entry-version` 手動同步 | 零 build 下改由伺服器讀取 |
| `src/ui/chat.ts` 等模組路徑 | `online/ui.js` 單檔承載大廳＋房間＋聊天＋戰情 | 維持零 build 的檔案組織 |
| 部署 `--max-instances 1`、512Mi | 沿用（session-affinity 綁定 WS） | 單實體讓 in-memory 房間狀態一致 |

---

## 6.5 工作流決策（AGENTS.md 的由來）

使用者於 2026-08-28 明示訂立的三條鐵則（session `cfe556e4` turn 1），已固化為 `AGENTS.md`：

1. **自動 Commit**：任何變更通過測試後立即 commit，不留未提交變更。
2. **Commit 訊息**：繁體中文、`feat(範圍): 摘要` / `fix(範圍): 摘要` 格式、內文 Markdown 條列詳述影響範圍——本專案 65 個 commit 全數符合，成為本規格書的重要史料來源。
3. **版號與部署**：每次 commit 遞增版號（patch 為主），`package.json` 與 `index.html` 入口頁版號必須同步；commit 後 `bash deploy.sh` 部署 Cloud Run，並以 `/api/health` 驗證版號生效。

**對未來維護的意義**：任何 Agent 或工程師修改本專案，都應沿用此工作流；版號不一致（入口頁 vs /api/health）會直接造成線上顯示錯誤（曾於 2026-08-28 發生大廳 Footer 顯示舊版號的問題，見 `a8a85ed`）。

---

## 6.6 尚未實作（提示詞有、現況無）與刻意取捨

| 項目 | 狀態 | 說明 |
|---|---|---|
| fairness（commit–reveal） | 刻意省略 | gomoku 無隱藏資訊，無防作弊需求（見 D5） |
| `pausedRemainingMs` 鐘暫停三態 | 已實作 | 移植提示詞 §4 的三態計時完整落地（`server/room.js`） |
| Vite / dev proxy | 不適用 | 零 build 前端直接由 express 靜態服務（見 D4） |
| `src/shared/canned.ts` 白名單 | 已實作並擴充 | 24 句（原 12 句） |
| Firestore TTL | 已實作 | finished 房 24h／未結束房 7 天，`deploy.sh` 部署後自動設定 TTL policy |

> 詳細的現況規格（API 表、訊息表、UI 清單）見第 02／04／05 章；本章僅記錄「為什麼」與「從哪來」。