#!/usr/bin/env bash
# 部署五子棋線上對戰到 Cloud Run（vertex-ai-sprint / asia-east1 / gomoku）
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vertex-ai-sprint}"
REGION="${REGION:-asia-east1}"
SERVICE="${SERVICE:-gomoku}"

echo "==> 專案：$PROJECT_ID · 區域：$REGION · 服務：$SERVICE"

gcloud config set project "$PROJECT_ID" 2>/dev/null

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
  --set-env-vars "FIRESTORE_ENABLED=1,FIRESTORE_COLLECTION=rooms,NODE_ENV=production"

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