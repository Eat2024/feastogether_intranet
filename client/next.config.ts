import type { NextConfig } from "next";
import path from "node:path";

const API_PROXY_TARGET =
  process.env.API_PROXY_TARGET ?? "http://localhost:3001";
const WORKSPACE_ROOT = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: WORKSPACE_ROOT,
  turbopack: {
    // pnpm workspace 的實體套件位於 root node_modules/.pnpm；必須允許
    // Turbopack 解析 client/ 目錄外的 symlink target。
    root: WORKSPACE_ROOT,
  },

  experimental: {
    // 簽署時會一併送出多個手寫簽名圖檔（PNG），預設 1MB 上限可能不足
    serverActions: { bodySizeLimit: "2mb" },
    // 避免 dev 持久快取導致共用 layout 的 chunk 在重建期間失效。
    turbopackFileSystemCacheForDev: false,
  },

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
