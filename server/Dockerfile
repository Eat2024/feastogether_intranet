# ========================
# server（NestJS）獨立 image
# build context = repository root（共用 workspace lockfile）
# ========================
# Node ≥24.22.1
FROM node:24.22.1-alpine AS deps

WORKDIR /workspace
RUN corepack enable

# 先複製 workspace manifest 與唯一 lockfile（利用 layer 快取）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .github/scripts/install-git-hooks.cjs ./.github/scripts/install-git-hooks.cjs
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
# 完整依賴：build 需要 @nestjs/cli、typescript 等開發工具；只在此連網下載一次
RUN pnpm install --frozen-lockfile --filter feastogether-intranet-server...

# 複製後端原始碼並 build
FROM deps AS builder
COPY server ./server
RUN pnpm --filter feastogether-intranet-server build

# 執行期只需 dependencies：清掉 node_modules 後以同一份 store 離線重裝，不帶 jest、eslint、
# @nestjs/cli 等開發工具。直接在既有 node_modules 改裝 --prod 不會移除 .pnpm 內的開發套件。
FROM deps AS prod-deps
RUN rm -rf node_modules server/node_modules \
  && pnpm install --frozen-lockfile --prod --offline --filter feastogether-intranet-server...

# ========================
# Runtime stage
# ========================
FROM node:24.22.1-alpine

WORKDIR /workspace/server
ENV NODE_ENV=production

# server/node_modules 內的 pnpm symlink 指向 workspace root node_modules/.pnpm，
# 兩層都必須保留；package.json 則供 Node subpath imports（#app/*）解析。
COPY --from=prod-deps /workspace/node_modules /workspace/node_modules
COPY --from=prod-deps /workspace/server/node_modules ./node_modules
COPY --from=builder /workspace/server/package.json ./
COPY --from=builder /workspace/server/dist ./dist

EXPOSE 3000

# liveness：/api/health（alpine 內建 busybox wget）
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# 以非 root 執行（node:24-alpine 內建 node 使用者）。複製進來的檔案為
# world-readable，node 可讀 dist/node_modules。
USER node

CMD ["node", "dist/main.js"]
