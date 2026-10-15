import { isAdmin } from '@/features/export-history/admin';
import { getStoredFile } from '@/features/forms/files';
import { getCurrentUser } from '@/features/forms/orgChart';
import { getForm } from '@/features/forms/store';
import { listSigningTasks } from '@/features/my-signature/serverApi';
import { EsignApiError, esignFetch } from '@/lib/api/esign';

/**
 * 取得電子簽文件的原始檔（簽署前閱讀、編輯時預覽）。
 * 只有該文件的簽署人、建立人或管理者可以讀取；其他人一律回 404，不透露文件是否存在。
 * 加上 ?variant=completed 時取全員簽署完成的 PDF（僅後端文件）。
 */
export async function GET(request: Request, { params }: RouteContext<'/files/forms/[id]'>) {
  const { id } = await params;
  const form = getForm(id);
  // 不在 mock store 的是後端文件，權限由後端判斷
  if (!form) return backendPdf(id, new URL(request.url).searchParams.get('variant') === 'completed');

  const me = getCurrentUser();
  const allowed =
    form.signers.some((s) => s.id === me.id) || form.createdBy.employeeNo === me.employeeNo || isAdmin(me.id);
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

const DOCUMENT_ID = /^[1-9][0-9]*$/;
const SIGNER_PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 後端文件的 PDF：數字 id 為建立人檢視（文件 id），UUID 為簽署人檢視（signerPublicId） */
async function backendPdf(id: string, completed: boolean): Promise<Response> {
  try {
    let path: string | undefined;
    if (DOCUMENT_ID.test(id)) {
      path = `/esign/documents/${id}/${completed ? 'completed-file' : 'source-file'}`;
    } else if (SIGNER_PUBLIC_ID.test(id)) {
      if (!completed) {
        path = `/esign/signing-tasks/${id}/source-file`;
      } else {
        // 完成檔以文件 id 取得：從本人的簽署任務找出文件
        const task = (await listSigningTasks(false)).find((t) => t.signerPublicId === id);
        if (task) path = `/esign/documents/${task.document.id}/completed-file`;
      }
    }
    if (!path) return new Response('找不到文件', { status: 404 });

    const res = await esignFetch(path);
    // 錯誤沿用後端的回應（例如完成檔尚未產生時的 409 與訊息）
    if (!res.ok || !res.body) {
      return new Response(await res.text(), {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain; charset=utf-8' },
      });
    }
    return new Response(res.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store',
        'Content-Disposition': res.headers.get('Content-Disposition') ?? 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const status = error instanceof EsignApiError ? error.status : 502;
    return new Response(error instanceof Error ? error.message : '找不到文件', { status });
  }
}
