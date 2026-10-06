import { addExportRecord } from '@/features/export-history/store';
import { parseExportQuery } from '@/features/forms/export/exportQuery';
import { buildListExport } from '@/features/forms/export/listExport';
import { getForm } from '@/features/forms/store';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 下載簽署紀錄清單（Excel）；條件與匯出頁相同，由網址參數帶入。每次下載都會記入匯出紀錄 */
export async function GET(request: Request, { params }: RouteContext<'/forms/[id]/export/file'>) {
  const form = getForm((await params).id);
  if (!form || form.status === 'draft') return new Response('找不到可匯出的文件', { status: 404 });

  const query = parseExportQuery(Object.fromEntries(new URL(request.url).searchParams));
  const { file, count, scope, fileName } = await buildListExport(form, query);
  addExportRecord({
    kind: 'list',
    formId: form.id,
    formName: form.name,
    docNumber: form.docNumber ?? null,
    scope,
    count,
    query,
  });

  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': XLSX_MIME,
      // 中文檔名需以 RFC 5987 編碼；filename 為不支援時的英數備援
      'Content-Disposition': `attachment; filename="${form.docNumber ?? form.id}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  });
}
