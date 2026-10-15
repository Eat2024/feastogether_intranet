'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

export default function MainError({ reset }: { reset: () => void }) {
  return <Stack spacing={2}>
    <Alert severity="error">電子簽服務暫時無法使用，請稍後再試。</Alert>
    <Button onClick={reset}>重新載入</Button>
  </Stack>;
}
