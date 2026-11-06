/**
 * Next server 啟動時執行一次：server-only 設定格式錯誤時讓啟動失敗，不等到有人開啟隱藏路徑才發現。
 * Next 也會為 Edge runtime 編譯這個檔；允許清單用到 node:net，只在 Node.js runtime 載入（proxy 也跑在 Node.js）。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { parseAllowedNetworks } = await import('@/lib/allowedNetworks');
    parseAllowedNetworks(process.env.SUPER_USER_ALLOWED_CIDRS);
  }
}
