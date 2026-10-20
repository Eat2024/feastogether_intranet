'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useRef, useState, useTransition } from 'react';
import { noteLength, SIGNER_NOTE_MAX } from './signerNote';

/**
 * 簽署人表格的「備註」欄：直接顯示輸入框，點擊輸入框後才出現「儲存」「取消」。
 * Enter 儲存、Esc 取消；內容有修改但尚未儲存時，離開輸入框仍保留按鈕，避免誤以為已儲存。
 * 實際儲存方式由 onSave 決定（mock 版為 Server Action；正式文件呼叫管理備註 API）。
 */
export default function SignerNoteCell({
  signerName,
  note = '',
  onSave,
}: {
  signerName: string;
  note?: string;
  /** 儲存備註；回傳儲存後的備註（已去除前後空白）或錯誤訊息 */
  onSave: (note: string) => Promise<{ note: string } | { error: string }>;
}) {
  const [value, setValue] = useState(note);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // 儲存後伺服器回傳新的備註：未在編輯時同步到輸入框
  const [syncedNote, setSyncedNote] = useState(note);
  if (note !== syncedNote) {
    setSyncedNote(note);
    if (!active) setValue(note);
  }

  const length = noteLength(value.trim());
  const tooLong = length > SIGNER_NOTE_MAX;
  const dirty = value.trim() !== note;

  const cancel = () => {
    if (pending) return;
    setValue(note);
    setError(null);
    setActive(false);
    inputRef.current?.blur();
  };
  const save = () => {
    if (pending || tooLong) return;
    if (!dirty) {
      setValue(note);
      setActive(false);
      inputRef.current?.blur();
      return;
    }
    startTransition(async () => {
      const res = await onSave(value);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setValue(res.note);
      setError(null);
      setActive(false);
      inputRef.current?.blur();
    });
  };

  return (
    <Box
      // 焦點移到按鈕時不算離開；完全離開且沒有修改才收起按鈕
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && !dirty && !pending) setActive(false);
      }}
    >
      <TextField
        size="small"
        fullWidth
        inputRef={inputRef}
        value={value}
        disabled={pending}
        placeholder="輸入備註"
        onFocus={() => setActive(true)}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          // 注音等輸入法選字時的 Enter 不送出
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            cancel();
          }
        }}
        error={tooLong || !!error}
        slotProps={{ htmlInput: { 'aria-label': `${signerName} 的備註` } }}
      />
      {active && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
          <Typography
            variant="helper"
            component="span"
            role={error ? 'alert' : undefined}
            sx={{ mr: 'auto', color: tooLong || error ? 'error.main' : undefined }}
          >
            {error ?? `${length}/${SIGNER_NOTE_MAX}`}
          </Typography>
          <Button size="small" onClick={cancel} disabled={pending}>
            取消
          </Button>
          <Button size="small" variant="contained" onClick={save} disabled={tooLong} loading={pending}>
            儲存
          </Button>
        </Box>
      )}
    </Box>
  );
}
