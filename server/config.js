"use strict";
/* 伺服器常數（皆可 env 覆寫）。在 Cloud Run CPU throttling 下，計時器僅供 nudge，
   真相一律以 deadline 時間戳惰性判定。 */

function intEnv(name, fallback) {
  var v = parseInt(process.env[name], 10);
  return isFinite(v) && v > 0 ? v : fallback;
}

module.exports = {
  PORT: intEnv("PORT", 8787),

  // 回合鐘與斷線寬限
  TURN_MS: intEnv("TURN_MS", 60_000),
  GRACE_MS: intEnv("GRACE_MS", 90_000),

  // 心跳：30s ping，沒 pong 就 terminate
  HEARTBEAT_MS: intEnv("HEARTBEAT_MS", 30_000),

  // 聊天限速：滑動窗口 + 最小間隔
  CHAT_BURST: intEnv("CHAT_BURST", 5),
  CHAT_WINDOW_MS: intEnv("CHAT_WINDOW_MS", 10_000),
  CHAT_MIN_GAP_MS: intEnv("CHAT_MIN_GAP_MS", 600),

  // 房間快取 sweep 週期
  ROOM_SWEEP_MS: intEnv("ROOM_SWEEP_MS", 60_000),

  // TTL：finished 房 24h；未結束房最後更新後 7 天
  FINISHED_TTL_MS: intEnv("FINISHED_TTL_MS", 24 * 3600_000),
  STALE_TTL_MS: intEnv("STALE_TTL_MS", 7 * 24 * 3600_000),

  // 持久化
  FIRESTORE_ENABLED: process.env.FIRESTORE_ENABLED !== "0",
  FIRESTORE_COLLECTION: process.env.FIRESTORE_COLLECTION || "rooms",
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || undefined,

  // 版號（顯示於 /api/health 與頁腳）
  VERSION: process.env.APP_VERSION || require("../package.json").version
};