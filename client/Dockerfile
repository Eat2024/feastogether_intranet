# ========================
# client（Next.js）獨立 image
# build context = repository root（共用 workspace lockfile）
# 採用 Next.js standalone output（自包含 server、image 最小）
# ========================
FROM node:20-alpine AS builder

WORKDIR /workspace
RUN corepack enable

# 先複製 workspace manifest 與唯一 lockfile（利用 layer 快取）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN pnpm install --frozen-lockfile --filter feastogether-intranet-client...

ARG API_PROXY_TARGET=http://server:3000
ENV API_PROXY_TARGET=$API_PROXY_TARGET

ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

# 複製前端原始碼並 build
COPY client ./client
RUN pnpm --filter feastogether-intranet-client build

# ========================
# Runtime stage
# ========================
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# monorepo standalone 產物保留 client/ 路徑；static / public 需手動帶入。
COPY --from=builder /workspace/client/.next/standalone ./
COPY --from=builder /workspace/client/public ./client/public
COPY --from=builder /workspace/client/.next/static ./client/.next/static

EXPOSE 3000

CMD ["node", "client/server.js"]
