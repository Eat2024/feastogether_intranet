import { NextRequest, NextResponse } from 'next/server';
import { loginHref } from '@/features/auth/navigation';

/** 此處只檢查 cookie 是否存在；有效性仍由後端 session 與業務 API 驗證。 */
export function proxy(request: NextRequest) {
  const returnTo = request.nextUrl.pathname + request.nextUrl.search;
  if (!request.cookies.get('FT_ESIGN_SESSION')?.value) {
    return NextResponse.redirect(new URL(loginHref(returnTo), request.url));
  }
  const headers = new Headers(request.headers);
  // 覆寫外部傳入值，供 Server Component / Action 的 401 返回目前頁面。
  headers.set('x-esign-return-to', returnTo);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/', '/forms/:path*', '/my-signature/:path*', '/export-history/:path*'],
};
