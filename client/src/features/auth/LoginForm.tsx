'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import { envelopeData, envelopeError } from '@/lib/api/envelope';
import { safeReturnPath } from './navigation';

const UNAVAILABLE = '登入服務暫時無法使用，請稍後再試或聯絡資訊人員';

export default function LoginForm() {
  const params = useSearchParams();
  const [empId, setEmpId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const redirectTo = safeReturnPath(params.get('redirectTo'));

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!empId.trim() || !password) {
      setError('請輸入員工編號與密碼');
      return;
    }
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId: empId.trim(), password }),
        cache: 'no-store',
      });
      const body: unknown = await response.json().catch(() => null);
      const data = envelopeData(body);
      if (!response.ok || !data || typeof data !== 'object' || !('user' in data)) {
        // 登入本身的 401 只顯示帳密錯誤，不套用業務 API 的過期導向。
        setError([400, 401, 403, 429].includes(response.status) ? envelopeError(body) ?? '登入失敗，請確認員工編號與密碼' : UNAVAILABLE);
        setPassword('');
        setPending(false);
        return;
      }
      // 由後端下發 HttpOnly cookie；整頁載入清除前一位使用者的 Router Cache。
      window.location.replace(redirectTo);
    } catch {
      setError(UNAVAILABLE);
      setPassword('');
      setPending(false);
    }
  }

  return (
    <Box component="main" sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3, bgcolor: 'background.default' }}>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 440, p: { xs: 3, sm: 5 } }}>
        <Stack component="form" onSubmit={login} spacing={3}>
          <Typography component="h1" variant="pageTitle">電子簽署系統</Typography>
          <Typography variant="body" color="text.secondary">請輸入員工編號與密碼登入。</Typography>
          {params.get('expired') === '1' && <Alert severity="info">登入已失效，請重新登入。</Alert>}
          {error && <Alert severity="error" role="alert">{error}</Alert>}
          <TextField label="員工編號" name="empId" autoComplete="username" required fullWidth
            value={empId} onChange={(event) => setEmpId(event.target.value)} disabled={pending}
            slotProps={{ htmlInput: { maxLength: 32 } }} />
          <TextField label="密碼" name="password" autoComplete="current-password" required fullWidth
            type={showPassword ? 'text' : 'password'} value={password}
            onChange={(event) => setPassword(event.target.value)} disabled={pending}
            slotProps={{
              htmlInput: { maxLength: 128 },
              input: { endAdornment: <InputAdornment position="end">
                <IconButton aria-label={showPassword ? '隱藏密碼' : '顯示密碼'} aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)} edge="end" disabled={pending}>
                  {showPassword ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
                </IconButton>
              </InputAdornment> },
            }} />
          <Button variant="contained" size="large" type="submit" loading={pending}>登入</Button>
        </Stack>
      </Paper>
    </Box>
  );
}
