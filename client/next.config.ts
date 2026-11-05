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

  // 隱藏維護入口的網址含入口值：開發時不記這類 request log（正式環境 next start 本來就不記 request log）。
  logging: {
    incomingRequests: {
      ignore: [/^\/ops-access\//, /^\/api\/auth\/super-user-entries\//],
    },
  },

  // 只套用在隱藏維護入口（不影響 WebView bridge 與可被入口網 iframe 嵌入的員工頁）：
  // 不送出含入口的 Referer、不讓搜尋引擎收錄、不允許被任何頁面嵌入。
  // Cache-Control 不在此設定：Next 會覆寫頁面的 Cache-Control，動態頁面本來就是 private, no-store。
  async headers() {
    return [
      {
        source: "/ops-access/:entryKey",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
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
