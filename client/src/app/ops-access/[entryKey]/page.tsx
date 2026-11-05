import PublicPageShell from '@/components/PublicPageShell';
import SuperUserLoginForm from '@/features/super-user-login/SuperUserLoginForm';
import type { Metadata } from 'next';
import { connection } from 'next/server';

export const metadata: Metadata = { title: '維護登入' };

/**
 * Super user 隱藏維護入口。入口由 proxy 在渲染前驗證（無效時改寫成 404），這裡不重查。
 * 不放在 (main)：沒有側邊欄，也不需要既有會話。
 * connection() 讓頁面每次請求時渲染：含入口的 HTML 不進 Next 快取，回應為 Cache-Control no-store。
 * Referrer-Policy、X-Robots-Tag、frame-ancestors 由 next.config.ts 的 headers 設定。
 */
export default async function OpsAccessPage({ params }: PageProps<'/ops-access/[entryKey]'>) {
  await connection();
  const { entryKey } = await params;
  return (
    <PublicPageShell>
      <SuperUserLoginForm entryKey={entryKey} />
    </PublicPageShell>
  );
}
