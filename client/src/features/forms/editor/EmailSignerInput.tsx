'use client';

import { isValidEmail, MAX_EMAIL_LENGTH, normalizeEmail } from '@/lib/email';
import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type KeyboardEvent } from 'react';

export type EmailSigner = { email: string; name: string };

const MAX_NAME_LENGTH = 50;

/** 以 Email 新增未列入組織架構的簽署人（例如尚未建檔的新進同仁） */
export default function EmailSignerInput({
  value,
  onChange,
}: {
  value: EmailSigner[];
  onChange: (next: EmailSigner[]) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  const add = () => {
    const normalized = normalizeEmail(email);
    if (!normalized) return setError('請輸入 Email');
    if (!isValidEmail(normalized)) return setError('Email 格式不正確');
    if (value.some((s) => s.email === normalized)) return setError('此 Email 已加入');
    onChange([...value, { email: normalized, name: name.trim() }]);
    setEmail('');
    setName('');
    setError(undefined);
  };

  // 在任一欄位按 Enter 即加入（輸入法選字中的 Enter 不算）
  const onEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      add();
    }
  };

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="label" component="div">
          以 Email 新增簽署人
        </Typography>
        <Typography variant="helper">
          不在組織架構中的同仁（例如尚未建檔的新進同仁），可直接輸入 Email 加入簽署。
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          type="email"
          label="Email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(undefined);
          }}
          onKeyDown={onEnter}
          error={!!error}
          helperText={error}
          sx={{ flex: '2 1 240px' }}
          slotProps={{ htmlInput: { maxLength: MAX_EMAIL_LENGTH, autoComplete: 'off' } }}
        />
        <TextField
          size="small"
          label="姓名（選填）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
          sx={{ flex: '1 1 160px' }}
          slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
        />
        <Button variant="outlined" onClick={add} sx={{ height: 40, flexShrink: 0 }}>
          加入
        </Button>
      </Box>

      {value.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {value.map((s) => (
            <Chip
              key={s.email}
              size="small"
              variant="outlined"
              icon={<AlternateEmailRoundedIcon />}
              label={s.name ? `${s.name} ${s.email}` : s.email}
              onDelete={() => onChange(value.filter((x) => x.email !== s.email))}
            />
          ))}
        </Box>
      )}
    </Stack>
  );
}
