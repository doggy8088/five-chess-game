# 五子棋 · Five Chess（Gomoku）— 網頁遊戲軟體開發規格書

| 項目 | 內容 |
|---|---|
| 文件集版本 | v1.0 |
| 撰寫日期 | 2026-08-29 |
| 對應程式版本 | v0.3.3（`package.json`） |
| 文件狀態 | 正式（Approved） |
| 撰寫方式 | AI Agent 平行深讀全部原始碼（9,525 行 JS/HTML/CSS + 測試 + 部署腳本）與 Copilot CLI session log（17+ sessions、65 commits），逐項交叉考證 |

> 本規格書深入分析現有文件與原始碼撰寫而成，**所有論述均標註來源（`檔案:行號`）**；設計脈絡另從 GitHub Copilot CLI 的 session log 考古出當初的提示詞與最終決策（第 06 章）。

---

## 目錄

| 章 | 文件 | 內容摘要 |
|---|---|---|
| 一 | [`01-overview-platform.md`](01-overview-platform.md) | 產品概述、定位、目標使用者、**平臺選擇**（Web／雙部署：GitHub Pages 單機版 + Cloud Run 線上版）、執行環境、23 項環境變數、版號與發佈流程、健康檢查、25 列平臺功能矩陣 |
| 二 | [`02-architecture.md`](02-architecture.md) | **系統架構設計**：分層總覽、server-authoritative 原則、三端共用純函式規則引擎（三規則集＋禁手）、WS 協定全表（13 上行／19 下行）、房間生命週期與狀態機、deadline 惰性計時模型、儲存抽象（InMemory↔Firestore）、Cloud Run 部署拓撲與擴展限制、資產快取、安全總覽、測試分層 |
| 三 | [`03-tech-stack.md`](03-tech-stack.md) | **技術採用**：20 列選型總表（three.js r160 UMD 最後支援版、Express 5、ws、Firestore、node:test）、零 build 鐵則專章、3D 渲染與 2D 備援判準、認證（自製 HMAC session）、10 條禁止事項、依賴完整表 |
| 四 | [`04-frontend.md`](04-frontend.md) | **前台規劃**：畫面清單（DOM id 全表＋z-index 疊層）、入口探測、History API 路由、單機 3D 互動與 2D 降級、線上大廳與戰情中心、房間對局 HUD、聊天／人員／協商、重連與錯誤 UX、設計系統與 RWD／無障礙、12 張 Mermaid 流程圖 |
| 五 | [`05-backend-admin.md`](05-backend-admin.md) | **後端與後台設計**：14 模組地圖、25 條 REST route 完整規格表、WS 訊息全表、房間狀態機、限速與 guards、IP 監控告警、指標三層彙總、公告、管理後台（OAuth＋allowlist＋Chart.js）、Firestore schema 與 TTL、部署管線、22 項環境變數 |
| 六 | [`06-design-decisions.md`](06-design-decisions.md) | 設計決策與脈絡溯源：從 session log 與 git 史重建時間軸、當初提示詞原文節錄、14 項關鍵決策（D1–D14）、對移植提示詞的刻意適配差異表、AGENTS.md 工作流鐵則的由來 |

---

## 閱讀指引

- **想快速認識產品** → 01（總綱）→ 06（決策脈絡）
- **要改遊戲規則或引擎** → 02（2.3 規則引擎、2.4 WS 協定）＋ 04（前台行為）
- **要動伺服器或部署** → 05（API/WS/儲存/部署全表）＋ 01 §1.5–1.7（環境變數與發佈）
- **要接手 UI／新畫面** → 04（畫面清單、事件綁定、設計系統）＋ 03 §3（零 build 規範）
- **要維運或擴充後台** → 05 §5.9–5.13 ＋ 06 D8（後台源自 dark-chess 的同構移植）
- **想知道「為什麼長這樣」** → 06 全章

## 名詞與慣例（全書一致）

| 慣例 | 說明 |
|---|---|
| 證據標註 | `檔案:行號`（如 `server/room.js:123`），行號以 v0.3.2/0.3.3 原始碼為準 |
| 「現況」vs「建議」 | 第 02 章明確區分已實作行為與未來演進建議，不可混為一談 |
| 鐵則來源 | `AGENTS.md`（版號／commit／部署工作流）與移植提示詞（架構鐵則），詳見第 06 章 |
| 版號顯示 | 入口頁 `.entry-version`（手動同步）與 `/api/health`（伺服器讀 `package.json`）必須一致 |

## 產品速覽

- **單機**：15×15 五子棋，three.js 3D 棋盤（失敗自動降級 2D Canvas）、三難度 AI（自由／標準／連珠三規則集）、雙人同屏、悔棋限制、棋局分享與圖片下載
- **線上**：`/r/{roomId}` 邀請連結制房間、server-authoritative、60 秒回合鐘＋90 秒斷線寬限、聊天室（24 句快速訊息）、觀戰與戰情中心、指數退避重連
- **後台**：`/admin`（Google OAuth + allowlist）：戰情、指標圖表、IP 異常告警、公告、封鎖
- **平臺**：一份零 build 前端程式碼，雙部署 — GitHub Pages（單機版）與 Cloud Run（線上主站，`/api/health` 探測自動切換功能顯示）