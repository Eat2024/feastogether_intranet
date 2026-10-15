'use client';

import PageHeader from '@/components/PageHeader';
import { openPdf } from '@/features/forms/pdf/pdfjs';
import { envelopeData, envelopeError } from '@/lib/api/envelope';
import { toTaipeiDate } from '@/lib/dates';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import SignFlow from '../sign/SignFlow';
import { toMySignTask, type SigningTask } from '../taskForm';

// 外部簽署的身分只存在 HttpOnly cookie（路徑限定 /api/external-signing-task），
// 因此由瀏覽器直接呼叫同源 API，JavaScript 不會取得邀請 token
const TASK_URL = '/api/external-signing-task';
const SOURCE_URL = `${TASK_URL}/source-file`;
// 後端對所有失效情況回同一個 401，不區分原因
const UNAVAILABLE_MESSAGE =
  '此簽署連結目前無法使用：可能已完成簽署、文件已停止或已超過簽署期限。如有疑問請聯絡發起人。';

type Loaded = { task: SigningTask; pageCount: number } | { error: string };

/** 外部（Email）簽署人的簽署流程：沿用內部簽署的畫面 */
export default function ExternalSignFlow({ signerPublicId }: { signerPublicId: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // 開啟任務會寫入開啟紀錄：開發模式下 effect 會執行兩次，以 ref 確保只開啟一次
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        // 開啟任務：後端記錄開啟並確認仍可簽署
        const res = await fetch(TASK_URL, { method: 'POST', cache: 'no-store' });
        const data = envelopeData(await res.json().catch(() => null));
        const task = data as SigningTask | undefined;
        if (!res.ok || !task || task.signerPublicId !== signerPublicId) {
          setLoaded({ error: UNAVAILABLE_MESSAGE });
          return;
        }
        // 任務資料不含頁數，以原始 PDF 計算
        const pdf = await openPdf(SOURCE_URL);
        const pageCount = pdf.numPages;
        void pdf.loadingTask.destroy();
        setLoaded({ task, pageCount });
      } catch {
        setLoaded({ error: '無法開啟文件，請重新整理頁面後再試一次' });
      }
    })();
  }, [signerPublicId]);

  const submit = async (input: {
    signatures: Record<number, string>;
    consent: { version: string };
  }): Promise<{ error: string } | undefined> => {
    let res: Response;
    try {
      res = await fetch(`${TASK_URL}/signatures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          consentVersion: input.consent.version,
          accepted: true,
          signatures: Object.entries(input.signatures).map(([fieldId, pngDataUrl]) => ({
            fieldId,
            pngDataUrl,
          })),
        }),
      });
    } catch {
      return { error: '無法連線到伺服器，請檢查網路後再試一次' };
    }
    if (!res.ok) {
      if (res.status === 401) return { error: UNAVAILABLE_MESSAGE };
      return { error: envelopeError(await res.json().catch(() => null)) ?? '送出失敗，請稍後再試' };
    }
    // 簽署成功後邀請連結即失效，改以回執查看結果
    router.replace(`/external-signatures/${encodeURIComponent(signerPublicId)}/completion`);
    return undefined;
  };

  if (!loaded) return <Typography variant="secondary">正在開啟文件…</Typography>;
  if ('error' in loaded) {
    return (
      <Alert severity="info" variant="outlined">
        {loaded.error}
      </Alert>
    );
  }

  const { task, pageCount } = loaded;
  const { form, me } = toMySignTask(task, new Date(), pageCount);
  return (
    <>
      <PageHeader
        title={form.name}
        description="請閱讀電子簽名告知與文件內容，完成所有簽名欄位後送出；日期欄位會在送出時自動帶入。"
      />
      <SignFlow
        // 簽署人視角只保留本人
        form={{ ...form, signers: [me] }}
        me={me}
        today={toTaipeiDate(new Date())}
        terms={{ version: task.consent.version, items: [task.consent.text] }}
        pdfUrl={SOURCE_URL}
        declineHref={null}
        onSign={submit}
      />
    </>
  );
}
