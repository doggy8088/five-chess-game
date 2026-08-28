# 五子棋 · Gomoku（3D 對戰 AI + 線上對戰）

> 3D 五子棋網頁遊戲：15×15 棋盤、三種難度 AI 對戰與雙人模式，three.js 3D 渲染，離線自動切換 2D Canvas，免安裝、免註冊，開啟即玩。內建**線上即時對戰**：房間邀請連結、回合鐘與斷線重連、聊天室、觀戰大廳，部署於 Google Cloud Run。

- **線上試玩**：<https://gomoku.game.miniasp.com/>（Cloud Run）
- **舊網址**：<https://five-chess-game.gh.miniasp.com/>（已 301/meta 重導向至 Cloud Run）
- **原始碼**：<https://github.com/doggy8088/five-chess-game>
- **作者**：[Will 保哥](https://www.facebook.com/will.fans/) · **授權**：MIT

---

## 目錄

- [遊戲簡介](#遊戲簡介)
- [線上對戰](#線上對戰)
- [管理後台](#管理後台)
- [使用說明](#使用說明)
- [遊戲規則](#遊戲規則)
- [各模式規則對照](#各模式規則對照)
- [開發與測試](#開發與測試)
- [部署](#部署)
- [專案結構](#專案結構)

---

## 線上對戰

部署於 Cloud Run 的完整線上對戰系統（單一服務同時提供網站、REST API 與 WebSocket）：

| 功能 | 說明 |
|------|------|
| **房間邀請** | 建立房間取得不可猜的邀請連結（`/r/{roomId}`），附 QR Code 與一鍵複製。 |
| **座位系統** | 建立者執黑先手、第二人遞補白方自動開打；第三人起為觀眾（可聊天、可觀戰）。 |
| **斷線重連** | 座位憑 `playerToken` 認領：同一連結重新打開即無縫續戰；WS 自動重連（指數退避）。 |
| **回合鐘** | 每手 60 秒；輪到誰走誰斷線，鐘暫停並給 90 秒重連寬限；逾期判負（伺服器時間戳惰性判定，重啟不溯及判負）。 |
| **協商功能** | 和棋、提前結束（不計勝負）、認輸、再來一局（重洗、換先手），皆需雙方同意。 |
| **聊天室** | 雙分頁抽屜（聊天室＋人員名單）、12 句快速訊息、未讀徽章、限速防灌水、觀眾可聊天。 |
| **戰情中心** | 首頁即時戰況：進行戰局、在線棋手、觀戰人數，一鍵進入觀戰（WS 推播＋HTTP 輪詢兜底）；「只看交戰中」開關、膠著／激戰標籤；等待房滿 30 秒才公開曝光、終局保留 5 分鐘。 |
| **全站公告** | 後台（`/admin`）發佈 `{t:"announcement", id, text, at}` 全體廣播，前台強制閱讀、按「我知道了」回傳 `{t:"announcementAck", id}` 已讀回條（localStorage 記住最近 50 筆，後台可查各則已讀追蹤）。 |
| **規則集選擇** | 建立房間時選擇「自由／標準／連珠」，對局全程依該規則集裁決。 |

> 純靜態部署（如 GitHub Pages）會自動探測不到對戰伺服器，此時線上功能整體隱藏、單機玩法不受影響。

---

## 管理後台

網站內建管理後台（admin console），入口為 `<正式機>/admin`，以 **Google 登入**驗證，僅 `ADMIN_EMAILS` allowlist 內的帳號可進入。

### 功能

- **即時指標卡**：進行戰局、在線棋手、觀戰人數、連線數等即時戰況總覽（`/api/admin/metrics/live`）。
- **全站公告已讀追蹤**：發佈全站公告（前台強制閱讀＋已讀回條）、查詢每則公告的已讀名單與已讀率。
- **負載圖表**：以 Chart.js 繪製每分鐘／每小時／每日三種粒度的負載曲線（HTTP 請求、WS 訊息、連線事件）。
- **IP 監控與封鎖踢線**：依 IP 統計流量、異常告警歷史、封鎖名單（限時 5m～7d 或永久）；被封鎖的 IP 連線即被踢線（`/admin`、健康檢查端點不受限）。

### 所需環境變數

| 變數 | 說明 | 預設 |
|------|------|------|
| `GOOGLE_CLIENT_ID` | Google OAuth client id（登入 ID token 的 audience，經 `/api/admin/config` 公開給登入頁） | 無（**必填**，未設無法登入後台） |
| `ADMIN_EMAILS` | 管理員 email allowlist（逗號分隔） | `doggy.huang@gmail.com` |
| `ADMIN_SESSION_SECRET` | 後台 session cookie 的 HMAC 簽章金鑰 | 未設時每次重啟隨機產生（**重啟即全員登出**，正式機建議設固定值） |
| `IP_ALERT_HTTP_PER_MIN` | 單一 IP 每分鐘 HTTP 請求告警閥值 | `120` |
| `IP_ALERT_WS_PER_MIN` | 單一 IP 每分鐘 WS 訊息告警閥值 | `600` |
| `IP_ALERT_CONN_PER_MIN` | 單一 IP 每分鐘連線事件告警閥值 | `10` |
| `IP_ALERT_HTTP_PER_HOUR` | 單一 IP 每小時 HTTP 請求告警閥值 | `2000` |

### 部署注意

- **Google OAuth 設定**：`GOOGLE_CLIENT_ID` 對應的 OAuth client，其 **Authorized JavaScript origins 必須包含正式機網域**（如 `https://gomoku.game.miniasp.com` 與 Cloud Run 網址），否則 Google 登入按鈕無法啟動。
- `ADMIN_SESSION_SECRET` 建議在部署環境設定固定亂數字串，避免每次部署重啟後管理員全員被登出。
- `deploy.sh` 會從本機環境帶入 `GOOGLE_CLIENT_ID`、`ADMIN_EMAILS`、`ADMIN_SESSION_SECRET`（未設時有安全預設，見上方表格），不會把任何金鑰寫進檔案。

---

## 遊戲簡介

這是一款在瀏覽器中直接執行的五子棋（Gomoku／ごもくならべ）遊戲，無需安裝、無需註冊，開啟網頁即可對局。

### 特色

- **15×15 標準棋盤**，共 225 個交點。
- **三種難度 AI**：簡單、中等、困難（困難採威脅感知 alpha-beta 搜索，並具備連續衝四殺 VCF 攻防，會主動防禦活叉與雙威脅）。
- **雙人對戰模式**：可切換為兩人本地對奕。
- **三種規則集**：依難度對應「自由五子棋」「標準無禁五子棋」「連珠（日規／國際連珠）」三套規則（詳見[各模式規則對照](#各模式規則對照)）。
- **3D 棋盤渲染**：以 [three.js](https://threejs.org/) 呈現立體棋盤，可拖曳旋轉、捲動縮放；若離線或無法載入 3D 引擎，會自動切換為 2D Canvas 備援渲染，確保遊戲始終可玩。
- **零依賴前端**：僅 three.js 透過 CDN 載入，其餘為純 HTML / CSS / JavaScript，不用建置、無本地相依。
- **離線可玩**：3D 引擎載入失敗時自動降級為 2D，不影響對局。
- **完整鍵盤／滑鼠操作**：點擊落子、撤銷、新局、切換模式與難度。

---

## 使用說明

### 線上遊玩

直接打開 [線上試玩網址](https://five-chess-game.gh.miniasp.com/) 即可開始。

### 本機執行

無需建置步驟，任一方式皆可：

```bash
# 方式一：用內建腳本起一個本地靜態伺服器（http://localhost:4321）
npm run serve

# 方式二：任意靜態伺服器指向專案根目錄
npx serve .
# 或 python -m http.server 8000
```

接著以瀏覽器開啟對應本機網址即可。亦可直接以瀏覽器開啟 `index.html`（3D 引擎需連線載入 CDN，離線時會自動改用 2D 模式）。

### 操作方式

| 操作 | 說明 |
|------|------|
| **點擊棋盤** | 在滑鼠游標對應的交點落子（黑先、白後，輪流落子）。 |
| **拖曳棋盤** | 旋轉 3D 棋盤視角（僅 3D 模式）。 |
| **捲動（滾輪）** | 縮放棋盤視野（僅 3D 模式）。 |
| **新局** | 清空棋盤、重新開始一局。 |
| **撤銷** | 悔棋；對戰 AI 時一次撤銷「己方＋AI」共兩手，雙人模式撤銷一手。 |
| **難度切換** | 簡單 / 中等 / 困難（同時決定規則集，詳見下文）。 |
| **模式切換** | 「對戰 AI」與「雙人類」互相切換。 |

### 介面元素

- **回合指示**：左上顯示「輪到黑棋／白棋」。
- **戰績面板**：局數、總子數（x / 225）、黑棋數、白棋數、進度條、對局狀態、對戰模式。
- **最後一手標記**：以紅環標示最近一手的位置。
- **勝局高亮**：連成五子（或獲勝連線）時以高亮標示。
- **結果看板**：對局結束時顯示勝負訊息，可「分享」棋局圖片（行動版開啟系統分享選單）或「下載圖片」直接儲存 PNG 檔。
- **禁手提示**：黑棋觸發禁手時，以浮現訊息提示禁手種類與處置（僅連珠模式）。

---

## 遊戲規則

以下為所有模式共通的基本規則。

### 棋盤與落子

- 棋盤為 **15×15**，共 **225 個交點**。
- **黑棋先手**，白棋後手，雙方輪流於空交點落子。
- 連線方向共四種：**橫向、直向、斜向 ↘（＼）、斜向 ↙（／）**。

### 勝負

- 連成**五子連線**者勝（各模式對「五子」的精確定義不同，詳見[各模式規則對照](#各模式規則對照)）。
- 棋盤下滿 225 子仍無人勝出則判**和棋**。

### 黑棋三大禁手（僅連珠／困難模式適用）

連珠規則中，先手黑棋受限於三大禁手；白棋無任何禁手。禁手定義如下：

- **三三禁手（雙活三）**：黑棋下一子同時形成兩個（或以上）的「活三」。
  - **活三**：再加一手即可在該方向形成「活四」（連續四子、兩端皆空）的開放三。
- **四四禁手（雙四）**：黑棋下一子同時形成兩個（或以上）的「四」（包含活四與衝四）。
  - **四**：再加一手即可成「精準五連」的連子型；只能湊成六子以上長連的「假四」不算。
- **長連禁手**：黑棋連出**六子或以上**（連六、連七等），超過五子不算勝，直接判禁手失敗。

#### 禁手優先序與寬容機制（連珠模式）

- **先五為勝優先**：若該手同時形成「精準五連」，則算勝，不視為禁手。
- 優先序為：**精準五連（勝）→ 長連 → 四四 → 三三**。
- **寬容機制**：黑棋禁手採「**首犯退回、再犯判負**」——當局首次觸發禁手時，該手退回並提示警告，玩家重新落子；當局再次違規則黑棋直接判負。

---

## 各模式規則對照

三種難度對應三套規則集，**切換難度即切換規則**：

| 項目 | 簡單 | 中等 | 困難 |
|------|------|------|------|
| **規則集** | 自由五子棋（Freestyle Gomoku） | 標準無禁五子棋（Standard Gomoku） | 連珠（Renju，日規／國際連珠） |
| **黑棋勝負** | 連成 **5 子或以上**（含長連）即勝 | 必須**剛好 5 子**連線才算勝 | 必須**剛好 5 子**才算勝 |
| **白棋勝負** | 連成 **5 子或以上**（含長連）即勝 | 必須**剛好 5 子**連線才算勝 | 連成 **5 子或以上**（含長連）即勝 |
| **長連（6 子以上）** | **算勝**（黑白皆然） | **不算勝**，雙方皆須繼續下 | 黑棋為**禁手（判負）**；白棋**算勝** |
| **黑棋禁手** | 無 | 無（雙方對等） | 三三／四四／長連 |
| **白棋禁手** | 無 | 無 | 無 |
| **雙方對等** | 是 | 是 | 否（黑棋受限） |

### 簡單模式 — 自由五子棋（Freestyle Gomoku）

最寬鬆的規則。黑白雙方對等、皆無禁手，只要連線達到**五子或超過五子**都算贏。長連（連六、連七等）直接判勝。

### 中等模式 — 標準無禁五子棋（Standard Gomoku）

雙方對等、皆無禁手，但獲勝條件嚴格為「**剛好五子連線（Exact five in a row）**」。超過五子的長連（Overline）**兩邊都不算贏**，必須繼續下。此規則避免長連爭議，強調精準五連的技巧。

### 困難模式 — 連珠（Renju，日規／國際連珠）

正統競技規則，黑白不對等：

- **白棋**：連成 5 子或以上（含長連）即勝，無禁手。
- **黑棋**：必須剛好 5 子才算勝；並受**三三、四四、長連**三大禁手限制（禁手定義見[上文](#黑棋三大禁手僅連珠困難模式適用)）。
- 黑棋禁手採「**首犯退回、再犯判負**」的寬容機制。
- 困難模式的 AI 同時具備必殺威脅攻防、連續衝四殺（VCF）攻防與威脅感知搜索（alpha-beta，深度 3），會避開黑棋禁手、主動防禦對手的活叉、雙威脅（含跳三、跳四等斷點棋型）與連續衝四殺。

> **三者關係**：簡單／中等皆為「無禁、雙方對等」，差別在於長連是否算勝（簡單算勝、中等不算勝）；困難則為完整連珠，黑棋多了禁手限制、白棋長連算勝。

---

## 開發與測試

### 技術棧

- **遊戲邏輯**：`game.js` 為純邏輯模組（UMD，Node 與瀏覽器通用），無 DOM、無 three.js 相依，可獨立單元測試，**client 與 server 共用同一份規則引擎**。
- **畫面渲染**：`app.js` 使用 three.js 進行 3D 渲染，並備有 2D Canvas 備援路徑。
- **線上伺服器**：Node 22 + `express`（靜態檔＋REST）＋ `ws`（WebSocket `/ws`），單一 port；持久化用可插拔 `RoomStore`（本機 InMemory ↔ 正式 Firestore TTL）。
- **測試**：Node 內建測試框架（`node:test` / `node:assert`），無第三方測試套件，涵蓋規則、伺服器行為（坐席／計時／聊天／協商）、整合（真實 HTTP＋WS）與客戶端通訊層。

### 指令

```bash
# 安裝依賴（僅 express、ws、@google-cloud/firestore）
npm install

# 執行全部測試（規則 / 伺服器 / 整合 / 客戶端通訊）
npm test

# 起本地對戰伺服器（http://localhost:8787，InMemoryStore）
npm run dev

# 起純靜態伺服器（無線上功能，探測失敗自動隱藏）
npm run serve
```

### 本機開發線上對戰

```bash
npm install
npm run dev          # http://localhost:8787（PORT 可用 env 覆寫）
```

開兩個瀏覽器分頁：第一個建立房間、把邀請連結貼到第二個瀏覽器即可對弈。

> 說明：`package.json` 的 `test` / `coverage` 腳本以 glob 展開（`tests/*.test.js server/tests/*.test.js`）。

### AI 設計摘要

| 難度 | 策略 |
|------|------|
| 簡單 | 具隨機性的貪婪評估（會擋殺但不總是最佳）。 |
| 中等 | 貪婪評估＋立即取殺／擋殺。 |
| 困難 | 必殺威脅攻防（活四／跳四／雙四）＋**連續衝四殺（VCF）攻防**＋威脅感知 alpha-beta 搜索（深度 3、節點預算上限）。VCF 只搜尋「衝四」這種迫使對手回擋的著手，分支極窄可深搜（手數上限 10、節點預算 12000），能看穿多手後的強制連四取勝，並在對手有連四殺時主動破壞。棋型評估採整線樣式比對，能辨識跳三 `●●_●`、跳四 `●●_●●` 等帶斷點的威脅，並依連珠規則避開黑棋禁手。 |

---

## 部署

部署到 Google Cloud Run（專案 `vertex-ai-sprint`、region `asia-east1`、服務名 `gomoku`）：

```bash
gcloud auth login
bash deploy.sh        # 一鍵：啟用 API → Cloud Build → Cloud Run 部署 → Firestore TTL
```

手動部署（等價）：

```bash
gcloud run deploy gomoku \
  --source . \
  --project vertex-ai-sprint \
  --region asia-east1 \
  --session-affinity \      # WS 綁定同一實例
  --timeout 3600 \
  --min-instances 0 --max-instances 1 \  # 單實例讓記憶體 lobby 名單一致
  --memory 512Mi \
  --allow-unauthenticated \
  --set-env-vars "FIRESTORE_ENABLED=1,FIRESTORE_COLLECTION=rooms,NODE_ENV=production"
```

- **持久化**：正式環境用 Firestore（`rooms/{roomId}` 一房一文件），重啟後房間可重建；`expireAt` 欄位搭配 collection TTL policy 自動清理（finished 房 24 小時、未結束房 7 天）。`FIRESTORE_ENABLED=0` 切回 InMemoryStore。
- **環境變數**：`PORT`（Cloud Run 自帶）、`TURN_MS`（回合鐘，預設 60000）、`GRACE_MS`（斷線寬限，預設 90000）、`APP_VERSION`；管理後台另需 `GOOGLE_CLIENT_ID`、`ADMIN_EMAILS`、`ADMIN_SESSION_SECRET`（詳見[管理後台](#管理後台)）。
- **健康檢查**：`/api/healthz` 回 `ok`；`/api/health` 回 `{ok, version}`。

---

### 專案結構

```
.
├── index.html           # 頁面結構與 SEO 中繼資料
├── game.js              # 純遊戲邏輯（UMD，可 Node 測試，client/server 共用）
├── app.js               # 畫面控制與渲染（3D three.js / 2D Canvas 備援）＋線上模式整合
├── styles.css           # 樣式
├── shared/
│   └── protocol.js      # 線上協定共用型別、常數、文案（client/server 共用）
├── online/              # 瀏覽器端線上模組
│   ├── socket.js        #   ReconnectingSocket（指數退避重連）
│   ├── session.js       #   OnlineSession（join 重送、seq、deadline 倒數）
│   ├── tokens.js        #   座位 token localStorage
│   └── ui.js            #   畫面路由、戰情中心、聊天 drawer、協商 dialog 黏合
├── server/              # 線上對戰伺服器（Node 22 + express + ws）
│   ├── index.js         #   HTTP API、SPA 路由、WS upgrade、心跳
│   ├── room.js          #   房間本體（坐席、回合鐘、協商、聊天、presence）
│   ├── rooms.js         #   RoomManager（快取、並發載入合併、lobby 推播、sweep）
│   ├── guards.js        #   上行訊息白名窄化
│   ├── ids.js / config.js
│   ├── store.js         #   RoomStore 介面 + InMemoryStore
│   ├── firestore-store.js # FirestoreStore（TTL）
│   └── tests/           #   伺服器行為測試
├── tests/               # 規則邏輯、headless DOM、整合（真實 HTTP+WS）、通訊層測試
│   ├── game.test.js
│   ├── app.smoke.test.js
│   ├── app3d.test.js
│   ├── online.test.js
│   └── integration.test.js
├── Dockerfile           # node:22-slim 生產映像
├── deploy.sh            # 一鍵部署（Cloud Run + Firestore TTL）
├── og-image.png         # OpenGraph 分享圖
├── CNAME                # 自訂網域（five-chess-game.gh.miniasp.com）
├── robots.txt           # 搜尋引擎爬蟲規則
└── package.json         # 專案資訊與腳本
```

---

## 授權

[MIT](LICENSE) © Will 保哥
