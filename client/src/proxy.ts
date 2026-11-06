import { NextResponse, type NextRequest } from "next/server";
import { isAllowedClient, parseAllowedNetworks } from "@/lib/allowedNetworks";

// 與 next.config.ts 的 /api rewrite 是同一個後端位址
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? "http://localhost:3001";
// 格式已由 instrumentation.ts 在啟動時檢查；未設定或空字串時隱藏路徑一律不存在
const ALLOWED_NETWORKS = parseAllowedNetworks(process.env.SUPER_USER_ALLOWED_CIDRS);

/** (main) 底下的員工頁面 */
const EMPLOYEE_PAGE = /^\/(?:(?:esign|travel)(?:\/.*)?)?$/;
/** 隱藏維護入口的公開網址 */
const ENTRY_URL = /^\/ops-access\/([^/]+)$/;
/** 實際頁面（app/ops-access-page/[entryKey]）：只能由這裡改寫進入 */
const ENTRY_PAGE = "/ops-access-page/";
/** 與 next.config.ts 的 /api/:path* rewrite 相同範圍：config rewrite 不分大小寫，/API/… 也會轉給後端 */
const API = /^\/api\//i;
/** 與後端 SuperUserEntryGuard 約定：帶這個 header 時回與不存在路由相同的 404 */
const ENTRY_DENIED_HEADER = "x-entry-network-denied";

const notFound = (request: NextRequest) =>
  NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });

/**
 * 要在進入頁面前判斷：在 layout 判斷時頁面會同時渲染，內容仍會出現在 RSC 回應裡。
 * matcher 會出現在公開的 _clientMiddlewareManifest.js，所以不列任何路徑，要處理的路徑都在這裡（只在伺服器端執行）判斷。
 * - 員工頁面（員工或其他已登入身分）：未登入、session 失效，或外部簽署人只帶外部存取 cookie 時一律回 404，
 *   不讓人從網址看出這些頁面存在。頁面資料仍由後端 AuthGuard 把關。
 * - 隱藏維護入口：來源網路在允許清單內且入口有效，才改寫到實際頁面並加安全標頭。/ops-access/* 本身沒有頁面，
 *   其餘情況不改寫，交給 Next 照不存在的網址處理（改寫到 /_not-found 會多出 x-middleware-rewrite 與不同的 Cache-Control）。
 *   錯誤訊息不含入口網址。
 * - /api：來源網路不在允許清單時加上拒絕標記，照常轉給後端，由隱藏入口的 guard 回與不存在路由相同的 404。
 * - 其他路徑（公開頁、靜態檔）直接通過，不查 session。
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (EMPLOYEE_PAGE.test(pathname)) return checkSession(request);
  if (pathname.startsWith(ENTRY_PAGE)) return notFound(request);

  if (API.test(pathname)) return markApiNetwork(request);
  const entryKey = ENTRY_URL.exec(pathname)?.[1];
  if (entryKey && isAllowedClient(ALLOWED_NETWORKS, request.headers)) return openEntry(request, entryKey);
}

async function checkSession(request: NextRequest) {
  const response = await fetch(`${API_PROXY_TARGET}/api/auth/session`, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  });
  if (response.status === 401) return notFound(request);
  if (!response.ok) throw new Error(`session 檢查失敗：HTTP ${response.status}`);
}

/**
 * 每個 /api 請求都標記，不比對隱藏 API 的路徑：後端會解碼百分比編碼（例如 %73uper-user-entries），
 * 只比對路徑會被繞過。由後端回 404，是因為 proxy 自己改寫或回應都會與後端的 404 不同。標記不會出現在回應裡。
 */
function markApiNetwork(request: NextRequest) {
  if (isAllowedClient(ALLOWED_NETWORKS, request.headers)) return;
  const headers = new Headers(request.headers);
  headers.set(ENTRY_DENIED_HEADER, "1");
  return NextResponse.next({ request: { headers } });
}

async function openEntry(request: NextRequest, entryKey: string) {
  const response = await fetch(`${API_PROXY_TARGET}/api/auth/super-user-entries/${entryKey}`, { cache: "no-store" });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`維護入口檢查失敗：HTTP ${response.status}`);
  const page = NextResponse.rewrite(new URL(`${ENTRY_PAGE}${entryKey}`, request.url));
  // 不送出含入口的 Referer、不讓搜尋引擎收錄、不允許被任何頁面嵌入（只套在有效入口，不影響 WebView 與可被嵌入的頁面）
  page.headers.set("Referrer-Policy", "no-referrer");
  page.headers.set("X-Robots-Tag", "noindex, nofollow");
  page.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  return page;
}

// 只排除靜態資源；/api 也要經過（隱藏 API 的來源網路限制）
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
