import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 簽署時會一併送出多個手寫簽名圖檔（PNG），預設 1MB 上限可能不足
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
