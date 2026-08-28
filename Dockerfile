# 五子棋線上對戰 — Cloud Run 單一服務：靜態檔 + REST + WebSocket
FROM node:22-slim

WORKDIR /app

# 先裝依賴（利用 Docker layer 快取）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# 複製應用程式
COPY index.html app.js game.js styles.css robots.txt favicon.ico CNAME* ./
COPY admin.html admin.js admin.css ./
COPY shared ./shared
COPY online ./online
COPY server ./server
COPY assets ./assets

ENV PORT=8080
ENV NODE_ENV=production
# 正式環境啟用 Firestore 持久化（可用 FIRESTORE_ENABLED=0 切回 in-memory）
ENV FIRESTORE_ENABLED=1

EXPOSE 8080

CMD ["node", "server/index.js"]