#!/usr/bin/env bash
# 部署五子棋線上對戰到 Cloud Run（vertex-ai-sprint / asia-east1 / gomoku）
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vertex-ai-sprint}"
REGION="${REGION:-asia-east1}"
SERVICE="${SERVICE:-gomoku}"

# 管理後台（/admin）所需環境變數，從本機環境帶入；未設定時沿用正式機現值，
# 避免每次部署把 GOOGLE_CLIENT_ID / ADMIN_SESSION_SECRET 清空（secret 被清會全員被登出）。
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
ADMIN_EMAILS="${ADMIN_EMAILS:-doggy.huang@gmail.com}"
ADMIN_SESSION_SECRET="${ADMIN_SESSION_SECRET:-}"

echo "==> 專案：$PROJECT_ID · 區域：$REGION · 服務：$SERVICE"

gcloud config set project "$PROJECT_ID" 2>/dev/null

if [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$ADMIN_SESSION_SECRET" ]; then
  echo "==> 本機未設定後台環境變數，嘗試沿用正式機現值…"
  CURRENT_ENV=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' 2>/dev/null || true)
  if [ -z "$GOOGLE_CLIENT_ID" ] && echo "$CURRENT_ENV" | grep -q "GOOGLE_CLIENT_ID"; then
    GOOGLE_CLIENT_ID=$(echo "$CURRENT_ENV" | tr ';' '\n' | grep "GOOGLE_CLIENT_ID" | sed -E "s/.*'value': '([^']*)'.*/\1/")
  fi
  if [ -z "$ADMIN_SESSION_SECRET" ] && echo "$CURRENT_ENV" | grep -q "ADMIN_SESSION_SECRET"; then
    ADMIN_SESSION_SECRET=$(echo "$CURRENT_ENV" | tr ';' '\n' | grep "ADMIN_SESSION_SECRET" | sed -E "s/.*'value': '([^']*)'.*/\1/")
  fi
fi

if [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$ADMIN_SESSION_SECRET" ]; then
  echo "==> ⚠️  警告：管理後台環境變數未設定齊全"
  [ -z "$GOOGLE_CLIENT_ID" ] && echo "    GOOGLE_CLIENT_ID 留空 → 後台 Google 登入需設定，未設將無法登入 /admin"
  [ -z "$ADMIN_SESSION_SECRET" ] && echo "    ADMIN_SESSION_SECRET 留空 → SESSION_SECRET 留空則重啟後 session 失效（全員被登出）"
fi

echo "==> 啟用必要 API（run / firestore / cloudbuild）"
gcloud services enable run.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com --project "$PROJECT_ID"

echo "==> 建置並部署（Cloud Build，含 session-affinity 綁定 WS）"
gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --session-affinity \
  --timeout 3600 \
  --min-instances 0 \
  --max-instances 1 \
  --memory 512Mi \
  --cpu 1 \
  --allow-unauthenticated \
  --set-env-vars "FIRESTORE_ENABLED=1,FIRESTORE_COLLECTION=rooms,NODE_ENV=production,GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID},ADMIN_EMAILS=${ADMIN_EMAILS},ADMIN_SESSION_SECRET=${ADMIN_SESSION_SECRET}"

echo "==> 設定 Firestore TTL（finished 房 24h / 未結束房 7 天，自動刪除過期房間文件）"
echo "    （首次部署請確認 rooms collection 已有 expireAt 欄位文件後再執行）"
gcloud firestore fields ttls update expireAt \
  --collection-group=rooms \
  --enable-ttl \
  --project "$PROJECT_ID" || echo "    TTL 設定略過（可能已啟用或尚無文件）"

SERVICE_URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')
echo "==> 部署完成：$SERVICE_URL"
echo "==> 驗證："
echo "    curl $SERVICE_URL/api/healthz"
echo "    curl $SERVICE_URL/api/health"