'use client';

import PageHeader from '@/components/PageHeader';
import SigningHistory, { type HistoryItem } from '@/features/forms/detail/SigningHistory';
import { envelopeData } from '@/lib/api/envelope';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

type ReceiptStatus = {
  title: string;
  status: 'draft' | 'active' | 'finalizing' | 'completed' | 'stopped';
  completedAt: string | null;
  stoppedAt: string | null;
};

type Loaded = { receipt: ReceiptStatus; history: HistoryItem[] } | { error: string };

const STATUS_TEXT: Record<ReceiptStatus['status'], { severity: 'success' | 'info' | 'warning'; text: string }> = {
  draft: { severity: 'info', text: '此文件目前無法查看。' },
  active: { severity: 'success', text: '你已完成簽署。其他簽署人全部完成後，即可在此下載完成文件。' },
  finalizing: { severity: 'info', text: '所有簽署人已完成簽署，正在產生完成文件，請稍後重新整理此頁。' },
  completed: { severity: 'success', text: '文件已完成簽署，可以下載完成文件。' },
  stopped: { severity: 'warning', text: '此文件已停止簽署。' },
};

/**
 * 外部簽署人完成簽署後的結果：處理狀態、完成文件與本人相關歷程。
 * 以簽署成功時取得的回執 cookie（路徑限定此文件）查詢；清除瀏覽器資料後無法復原。
 */
export default function ExternalCompletion({ signerPublicId }: { signerPublicId: string }) {
  const base = `/api/external-completions/${encodeURIComponent(signerPublicId)}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [statusRes, historyRes] = await Promise.all([
          fetch(base, { cache: 'no-store' }),
          fetch(`${base}/history`, { cache: 'no-store' }),
        ]);
        const receipt = envelopeData(await statusRes.json().catch(() => null)) as ReceiptStatus | undefined;
        const history = envelopeData(await historyRes.json().catch(() => null));
        if (!statusRes.ok || !receipt) {
          if (!cancelled) {
            setLoaded({ error: '無法查看簽署結果：此瀏覽器沒有這份文件的簽署回執，或回執已過期。' });
          }
          return;
        }
        if (!cancelled) setLoaded({ receipt, history: Array.isArray(history) ? (history as HistoryItem[]) : [] });
      } catch {
        if (!cancelled) setLoaded({ error: '無法連線到伺服器，請重新整理頁面後再試一次' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (!loaded) return <Typography variant="secondary">正在查詢簽署結果…</Typography>;
  if ('error' in loaded) {
    return (
      <Alert severity="info" variant="outlined">
        {loaded.error}
      </Alert>
    );
  }

  const { receipt, history } = loaded;
  const status = STATUS_TEXT[receipt.status];
  return (
    <>
      <PageHeader title={receipt.title} description="簽署結果" />
      <Alert
        severity={status.severity}
        variant="outlined"
        action={
          receipt.status === 'completed' ? (
            <Button component="a" href={`${base}/completed-file`} download startIcon={<DownloadRoundedIcon />}>
              下載完成文件
            </Button>
          ) : undefined
        }
      >
        {status.text}
      </Alert>
      <SigningHistory items={history} />
      <Typography variant="helper">
        此頁以瀏覽器保存的簽署回執開啟，原邀請連結已失效；清除瀏覽器資料後將無法再查看。
      </Typography>
    </>
  );
}
