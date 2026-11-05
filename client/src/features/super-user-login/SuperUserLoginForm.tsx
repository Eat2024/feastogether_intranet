'use client';

// Super user 帳密登入表單：錯誤都在表單內顯示（帳密錯誤不是登入過期，不開全站提示）。
// 成功後整頁 replace 到根路徑：清掉入口網址的瀏覽紀錄與舊會話的 query 快取，重新讀取目前身分。
import { createSuperUserSession, getSession } from '@/api/requests';
import { getErrorCode, getErrorMessage } from '@/lib/apiError';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { useState, type FormEvent } from 'react';

const enterRoot = () => window.location.replace('/');

/** 回傳要顯示的錯誤；null 代表不需顯示（已改為進入根路徑） */
async function loginErrorMessage(error: unknown): Promise<string | null> {
  const code = getErrorCode(error);
  if (code === 'AUTH_SUPER_USER_CREDENTIALS_INVALID') return '帳號或密碼錯誤';
  if (code === 'AUTH_SESSION_REPLACED') {
    // 同一個舊會話已被另一個登入取代（例如另一個分頁）：重新讀取目前身分，已是 Super user 就直接進入
    const current = await getSession().catch(() => null);
    if (current?.actor.kind === 'super_user') {
      enterRoot();
      return null;
    }
  }
  if (axios.isAxiosError(error) && error.response?.status === 429) {
    const seconds = Number(error.response.headers['retry-after']);
    if (seconds > 0) return `嘗試次數過多，請於 ${seconds} 秒後再試`;
  }
  return getErrorMessage(error);
}

export default function SuperUserLoginForm({ entryKey }: { entryKey: string }) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const login = useMutation({
    mutationFn: createSuperUserSession,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: () => {
      setAccount('');
      setPassword('');
      enterRoot();
    },
    onError: async (cause) => setError(await loginErrorMessage(cause)),
  });
  // 成功後到整頁導向完成前也保持停用，避免重送
  const busy = login.isPending || login.isSuccess;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    login.mutate({ entryKey, account, password });
  };

  return (
    <Paper
      component="form"
      onSubmit={submit}
      sx={{ width: '100%', maxWidth: 400, mx: 'auto', mt: { xs: 2, sm: 8 }, p: 3 }}
    >
      <Stack spacing={2}>
        <Typography variant="sectionTitle" component="h1">
          維護登入
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="帳號"
          name="account"
          autoComplete="username"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          disabled={busy}
          required
          fullWidth
        />
        <TextField
          label="密碼"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          required
          fullWidth
        />
        <Button type="submit" variant="contained" size="large" disabled={busy || !account || !password}>
          {busy ? '登入中…' : '登入'}
        </Button>
      </Stack>
    </Paper>
  );
}
