# ========================
# server（NestJS）獨立 image
# build context = repository root（共用 workspace lockfile）
# ========================
# Node ≥20.19
FROM node:20.19-alpine AS builder

WORKDIR /workspace
RUN corepack enable

# 先複製 workspace manifest 與唯一 lockfile（利用 layer 快取）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN pnpm install --frozen-lockfile --filter feastogether-intranet-server...

# 複製後端原始碼並 build
COPY server ./server
RUN pnpm --filter feastogether-intranet-server build

# ========================
# Runtime stage
# ========================
FROM node:20.19-alpine

WORKDIR /workspace/server
ENV NODE_ENV=production

# server/node_modules 內的 pnpm symlink 指向 workspace root node_modules/.pnpm，
# 兩層都必須保留；package.json 則供 Node subpath imports（#app/*）解析。
COPY --from=builder /workspace/node_modules /workspace/node_modules
COPY --from=builder /workspace/server/node_modules ./node_modules
COPY --from=builder /workspace/server/package.json ./
COPY --from=builder /workspace/server/dist ./dist

EXPOSE 3000

# liveness：/api/health（alpine 內建 busybox wget）
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# 以非 root 執行（node:20-alpine 內建 node 使用者）。複製進來的檔案為
# world-readable，node 可讀 dist/node_modules。
USER node

CMD ["node", "dist/main.js"]
