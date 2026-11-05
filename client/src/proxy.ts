import { NextResponse, type NextRequest } from "next/server";

// 與 next.config.ts 的 /api rewrite 是同一個後端位址
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? "http://localhost:3001";
const OPS_ACCESS_PREFIX = "/ops-access/";

const notFound = (request: NextRequest) =>
  NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });

/**
 * 要在進入頁面前判斷：在 layout 判斷時頁面會同時渲染，內容仍會出現在 RSC 回應裡。
 * - 隱藏維護入口：入口無效或已輪換時回 404（HTML 與 RSC 都不含登入表單）。錯誤訊息不含入口網址。
 * - 員工頁面（員工或 Super user 會話）：未登入、session 失效，或外部簽署人只帶外部存取 cookie 時一律回 404，
 *   不讓人從網址看出這些頁面存在。頁面資料仍由後端 AuthGuard 把關。
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith(OPS_ACCESS_PREFIX)) {
    const response = await fetch(
      `${API_PROXY_TARGET}/api/auth/super-user-entries/${pathname.slice(OPS_ACCESS_PREFIX.length)}`,
      { cache: "no-store" },
    );
    if (response.status === 404) return notFound(request);
    if (!response.ok) throw new Error(`維護入口檢查失敗：HTTP ${response.status}`);
    return;
  }

  const response = await fetch(`${API_PROXY_TARGET}/api/auth/session`, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  });
  if (response.status === 401) return notFound(request);
  if (!response.ok) throw new Error(`session 檢查失敗：HTTP ${response.status}`);
}

// 只涵蓋 (main) 底下的員工頁面與隱藏維護入口；外部簽署頁、公開驗證頁、入口網嵌入頁與 /api 不經過
export const config = {
  matcher: ["/", "/forms/:path*", "/my-signature/:path*", "/export-history/:path*", "/ops-access/:entryKey"],
};
