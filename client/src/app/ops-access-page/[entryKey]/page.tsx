import PublicPageShell from '@/components/PublicPageShell';
import SuperUserLoginForm from '@/features/super-user-login/SuperUserLoginForm';
import type { Metadata } from 'next';
import { connection } from 'next/server';

export const metadata: Metadata = { title: '維護登入' };

/**
 * Super user 隱藏維護入口，公開網址是 /ops-access/<入口>。proxy 在渲染前確認來源網路與入口有效，
 * 才改寫到這個頁面並加上 Referrer-Policy、X-Robots-Tag、frame-ancestors；直接開啟這個路徑回 404。這裡不重查。
 * /ops-access/* 本身沒有頁面：無效入口與不存在的網址走同一個 404，公開資源也不會載入這裡的程式碼。
 * 不放在 (main)：沒有側邊欄，也不需要既有會話。
 * connection() 讓頁面每次請求時渲染：含入口的 HTML 不進 Next 快取，回應為 Cache-Control no-store。
 */
export default async function OpsAccessPage({ params }: PageProps<'/ops-access-page/[entryKey]'>) {
  await connection();
  const { entryKey } = await params;
  return (
    <PublicPageShell>
      <SuperUserLoginForm entryKey={entryKey} />
    </PublicPageShell>
  );
}
