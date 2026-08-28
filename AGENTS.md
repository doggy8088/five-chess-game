# 五子棋（Gomoku）— Agent 指引

3D 網頁五子棋（three.js CDN + 2D Canvas 備援，零 build 前端），含線上對戰（`server/`：Node + Express + ws，部署於 Cloud Run + Firestore）與管理後台（`admin.html`）。

## 常用指令

- `npm test`：全部測試（`tests/*.test.js` 前端/E2E + `server/tests/*.test.js` 伺服器單元，node --test）
- `npm run dev`：本機起伺服器（FIRESTORE_ENABLED=0，InMemoryStore）
- `bash deploy.sh`：建置並部署到 Cloud Run（Cloud Build，含 session-affinity 綁定 WS）

## 正式環境網址

- **Cloud Run（線上對戰主站）**：https://gomoku-wpnna43hmq-de.a.run.app （專案 `vertex-ai-sprint` · 區域 `asia-east1` · 服務 `gomoku`）
- **管理後台**：`<正式機>/admin`（如 https://gomoku-wpnna43hmq-de.a.run.app/admin ，Google 登入，僅 `ADMIN_EMAILS` allowlist 可進入）
- **GitHub Pages（單機版靜態站）**：https://five-chess-game.gh.miniasp.com （CNAME 見 `CNAME`）
- 健康檢查：`GET /api/health`（回傳版號，部署後可用來確認新版已生效）。
- `bash deploy.sh` 部署完成後會在終端機顯示正式機網址與驗證指令。

### 管理後台備忘

- **相關環境變數**：`GOOGLE_CLIENT_ID`（Google OAuth client id，登入必填）、`ADMIN_EMAILS`（管理員 allowlist，逗號分隔，預設 `doggy.huang@gmail.com`）、`ADMIN_SESSION_SECRET`（session HMAC 金鑰；留空則重啟後 session 失效、全員登出）、`IP_ALERT_*`（IP 異常告警閥值，見 `server/ip-monitor.js`）。
- **健康驗證**：`curl <正式機>/api/health`。
- **後台快速驗證**（部署後）：
  - `curl -s <url>/admin -o /dev/null -w '%{http_code}'` → 預期 `200`（admin.html 殼正常載入）。
  - `curl -s <url>/api/admin/session` → 預期 `{"authenticated":false,...}`（未登入狀態正常）。

## 版號規則（每次更版必做）

- 版號來源是 `package.json` 的 `version`；`server/config.js` 讀取後經 `/api/health` 公開，首頁入口畫面的 `v0.x.x` 顯示在 `index.html` 的 `.entry-version`（**手動寫死，需同步更新**）。
- **每一次部署或發佈都必須遞增版號**：一般修錯用 patch +1（手動改 `package.json` 與 `index.html` 的入口版號並一起 commit）；功能較大的版本用 minor/major 遞增。
- 部署前先確認版號已遞增並 commit，再執行 `bash deploy.sh`；部署後用 `curl <正式機>/api/health` 驗證版號。

## Git 提交規則（每次更改必做）

- **自動 Commit**：每次完成任何程式碼或功能更改並通過測試後，必須自動建立 Git Commit，不可留未 commit 的變更。
- **Commit 訊息規範（Full Detailed zh-TW Log）**：
  - 必須使用**繁體中文（zh-TW）**撰寫，格式比照現行 history：`feat(範圍): 摘要` / `fix(範圍): 摘要`。
  - 首行簡明摘要該次變更主題。
  - 內文必須使用 Markdown 條列式詳細說明修改細節（含各功能模組、畫面、架構調整與影響範圍）。
- **遞增版號**：每次 commit 都要一併遞增版本號（`package.json` + `index.html` 入口頁版號顯示），版號變更也要寫進 commit 內文。

## 部署規則（每次發佈必做）

- commit 完成後執行 `bash deploy.sh` 部署 Cloud Run（專案 `vertex-ai-sprint` · 區域 `asia-east1` · 服務 `gomoku`）。
- 部署後驗證：`curl https://gomoku-wpnna43hmq-de.a.run.app/api/health`（版號要與剛 commit 的一致）、`curl https://gomoku-wpnna43hmq-de.a.run.app/api/healthz`。

## 架構鐵則

- 線上對戰為 server-authoritative：規則引擎 `game.js` 為純函式、零 DOM 依賴，client 與 server 共用；WS 協定型別在 `shared/protocol.js`。
- 計時一律以 deadline 時間戳惰性判定（`room.js` evaluate），setTimeout 只是輔助——Cloud Run CPU throttling 下計時器不可靠。
- 前端零 build：所有 JS/CSS 都是原生檔案直接載入（唯一的第三方資源 three.js / qrcode / Chart.js 以 `assets/vendor/` 或 CDN 載入），新增前端功能不得引入 bundler。
- 資產快取：`index.html` 的 `?v=__ASSET_VER__` 由伺服器以內容雜湊（sha1 前 8 碼）於請求時注入，新檔案也要掛上 `?v=__ASSET_VER__`。
- 驗證：`npm test`（root）。