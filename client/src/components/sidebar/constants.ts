// 側邊欄收合狀態存在 cookie，讓 (main)/layout 在伺服器端就畫出正確寬度，重新整理時不會先展開再收合。
// 獨立成檔：Server Component 從 'use client' 模組 import 常數只會拿到 client reference。
export const SIDEBAR_OPEN_COOKIE = "sidebar_open";
