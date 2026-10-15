import { isAdmin } from '@/features/export-history/admin';
import { getStoredFile } from '@/features/forms/files';
import { getCurrentUser } from '@/features/forms/orgChart';
import { getForm } from '@/features/forms/store';

/**
 * 取得電子簽文件的原始檔（簽署前閱讀、編輯時預覽）。
 * 只有該文件的簽署人、建立人或管理者可以讀取；其他人一律回 404，不透露文件是否存在。
 */
export async function GET(_request: Request, { params }: RouteContext<'/files/forms/[id]'>) {
  const form = getForm((await params).id);
  const me = getCurrentUser();
  const allowed =
    !!form &&
    (form.signers.some((s) => s.id === me.id) || form.createdBy.employeeNo === me.employeeNo || isAdmin(me.id));
  const file = allowed ? getStoredFile(form.upload?.fileId) : undefined;
  if (!file) return new Response('找不到文件', { status: 404 });

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      // 含個人資料：只供當下瀏覽，不給共用快取保存
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
