import { buildSignerXlsx } from '@/features/forms/export/buildXlsx';
import { buildSignerDeptTree, selectedDeptKeys, selectedDeptNames, signerDeptKey } from '@/features/forms/export/deptTree';
import { exportRows, parseExportQuery } from '@/features/forms/export/exportQuery';
import { getDeptName } from '@/features/forms/orgChart';
import { getForm } from '@/features/forms/store';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 下載簽署紀錄清單（Excel）；條件與匯出頁相同，由網址參數帶入 */
export async function GET(request: Request, { params }: RouteContext<'/forms/[id]/export/file'>) {
  const form = getForm((await params).id);
  if (!form || form.status === 'draft') return new Response('找不到可匯出的文件', { status: 404 });

  const query = parseExportQuery(Object.fromEntries(new URL(request.url).searchParams));
  const rows = exportRows(form, query, {
    deptOf: getDeptName,
    deptKeyOf: signerDeptKey,
    deptKeys: selectedDeptKeys(query.depts),
  });
  const deptNames = selectedDeptNames(query.depts, buildSignerDeptTree(form));
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const exportedAt = `${now.getFullYear()}/${p(now.getMonth() + 1)}/${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  // TODO: 串接登入後記錄匯出人與匯出時間（稽核用）
  const file = await buildSignerXlsx(form, query, rows, exportedAt, deptNames);
  const fileName = `${form.docNumber ?? form.id}_簽署紀錄_${stamp}.xlsx`;

  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': XLSX_MIME,
      // 中文檔名需以 RFC 5987 編碼；filename 為不支援時的英數備援
      'Content-Disposition': `attachment; filename="${form.docNumber ?? form.id}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  });
}
