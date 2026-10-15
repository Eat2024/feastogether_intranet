'use client';

import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { envelopeData } from '@/lib/api/envelope';
import { safeReturnPath } from '@/features/auth/navigation';

export default function OauthCallbackPage() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    // 授權碼僅保留在記憶體，立刻從網址移除；一次性 callback 不自動重試。
    window.history.replaceState(null, '', window.location.pathname);
    const state = params.get('state');
    const code = params.get('code');
    const error = params.get('error');
    const failed = () => window.location.replace('/login?oauthError=1');
    if (!state || (!code && !error)) {
      failed();
      return;
    }
    void fetch('/api/auth/oauth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, code: code ?? undefined, error: error ?? undefined, iss: params.get('iss') ?? undefined }),
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) throw new Error('登入未完成');
      const data = envelopeData(await response.json());
      if (!data || typeof data !== 'object' || !('redirectTo' in data) || typeof data.redirectTo !== 'string') throw new Error('登入回應格式錯誤');
      // 整頁載入，清除前一位使用者的 Router Cache。
      window.location.replace(safeReturnPath(data.redirectTo));
    }).catch(failed);
  }, []);

  return <Box component="main" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
    <CircularProgress />
    <Typography role="status" variant="body">統一登入處理中，請稍候…</Typography>
  </Box>;
}
