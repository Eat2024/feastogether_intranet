'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, useTransition } from 'react';
import { saveSheetDocument } from '../actions';
import type { EFormDoc, SheetInfo } from '../types';
import {
  DEFAULT_SHEET,
  SHEET_CODE_MAX,
  SHEET_FIELDS_MAX,
  SHEET_LABEL_MAX,
  SHEET_TITLE_MAX,
  SHEET_VALUE_MAX,
  SHEET_WALK_IN_MAX,
  validateSheet,
} from './rules';
import SheetView from './SheetView';

// 預覽時示意用的列數
const PREVIEW_ROWS = 3;

/** 新增／編輯簽到表（流程第一步）：設定表頭欄位，表格會依簽署名單自動產生 */
export default function SheetEditor({ form, locked = false }: { form?: EFormDoc; locked?: boolean }) {
  const [name, setName] = useState(form?.name ?? '');
  const [sheet, setSheet] = useState<SheetInfo>(() => form?.sheet ?? DEFAULT_SHEET);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const disabled = locked || pending;

  const update = (patch: Partial<SheetInfo>) => {
    setSheet((prev) => ({ ...prev, ...patch }));
    setError(undefined);
  };
  const updateField = (index: number, patch: Partial<SheetInfo['fields'][number]>) =>
    update({ fields: sheet.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) });
  const moveField = (index: number, delta: -1 | 1) => {
    const next = [...sheet.fields];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    update({ fields: next });
  };

  const submit = () => {
    if (!name.trim()) return setError('請輸入文件名稱');
    const checked = validateSheet(sheet);
    if ('error' in checked) return setError(checked.error);
    startTransition(async () => {
      const result = await saveSheetDocument({ id: form?.id, name, sheet: checked });
      if (result?.error) setError(result.error);
    });
  };

  const isDraftOrNew = !form || form.status === 'draft';

  return (
    <Stack spacing={3}>
      {locked && (
        <Alert severity="info" variant="outlined">
          此文件已有人簽到或已停止，簽到表設定已鎖定，僅能查看。
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={3}>
          <TextField
            label="文件名稱"
            required
            fullWidth
            value={name}
            disabled={disabled}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            helperText="顯示在電子簽列表與通知中，例如「2026 職場霸凌教育訓練簽到」"
          />

          <Box>
            <Typography variant="subheading" component="div" sx={{ mb: 1.5 }}>
              表單資訊
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                label="表單標題"
                required
                size="small"
                value={sheet.title}
                disabled={disabled}
                onChange={(e) => update({ title: e.target.value })}
                slotProps={{ htmlInput: { maxLength: SHEET_TITLE_MAX } }}
                sx={{ flex: '1 1 240px' }}
              />
              <TextField
                label="表單編號（選填）"
                size="small"
                value={sheet.formCode}
                disabled={disabled}
                placeholder="例如 FT-2100-01-007-001"
                onChange={(e) => update({ formCode: e.target.value })}
                slotProps={{ htmlInput: { maxLength: SHEET_CODE_MAX } }}
                sx={{ flex: '1 1 240px' }}
              />
            </Box>
          </Box>

          <Box>
            <Typography variant="subheading" component="div" sx={{ mb: 0.5 }}>
              表頭欄位
            </Typography>
            <Typography variant="helper" component="div" sx={{ mb: 1.5 }}>
              依順序以兩欄排列在表格上方；「出席人數」（應到／實到）由系統自動計算，不需另外新增。
            </Typography>
            <Stack spacing={1}>
              {sheet.fields.map((f, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    size="small"
                    label="欄位名稱"
                    value={f.label}
                    disabled={disabled}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    slotProps={{ htmlInput: { maxLength: SHEET_LABEL_MAX } }}
                    sx={{ width: 160, flexShrink: 0 }}
                  />
                  <TextField
                    size="small"
                    label="內容"
                    fullWidth
                    value={f.value}
                    disabled={disabled}
                    onChange={(e) => updateField(i, { value: e.target.value })}
                    slotProps={{ htmlInput: { maxLength: SHEET_VALUE_MAX } }}
                  />
                  <TooltipIconButton
                    label="上移"
                    icon={<ArrowUpwardRoundedIcon fontSize="small" />}
                    disabled={disabled || i === 0}
                    onClick={() => moveField(i, -1)}
                  />
                  <TooltipIconButton
                    label="下移"
                    icon={<ArrowDownwardRoundedIcon fontSize="small" />}
                    disabled={disabled || i === sheet.fields.length - 1}
                    onClick={() => moveField(i, 1)}
                  />
                  <TooltipIconButton
                    label={`刪除「${f.label || '未命名'}」`}
                    icon={<DeleteOutlineRoundedIcon fontSize="small" />}
                    color="error"
                    disabled={disabled}
                    onClick={() => update({ fields: sheet.fields.filter((_, j) => j !== i) })}
                  />
                </Box>
              ))}
            </Stack>
            <Button
              size="small"
              startIcon={<AddRoundedIcon />}
              sx={{ mt: 1 }}
              disabled={disabled || sheet.fields.length >= SHEET_FIELDS_MAX}
              onClick={() => update({ fields: [...sheet.fields, { label: '', value: '' }] })}
            >
              新增欄位（{sheet.fields.length}/{SHEET_FIELDS_MAX}）
            </Button>
          </Box>

          <Box>
            <Typography variant="subheading" component="div" sx={{ mb: 1.5 }}>
              空白列
            </Typography>
            <TextField
              size="small"
              type="number"
              label="空白列數"
              value={sheet.walkInSlots}
              disabled={disabled}
              onChange={(e) => update({ walkInSlots: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              slotProps={{ htmlInput: { min: 0, max: SHEET_WALK_IN_MAX } }}
              sx={{ width: 160 }}
              helperText={`0～${SHEET_WALK_IN_MAX} 列`}
            />
            <Typography variant="helper" component="div" sx={{ mt: 1 }}>
              保留給不在名單中的同仁（例如臨時參加）使用簽到連結簽到，用完即無法再加入。
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Box>
        <Typography variant="subheading" component="div" sx={{ mb: 1 }}>
          預覽
        </Typography>
        <SheetView
          sheet={sheet}
          rows={Array.from({ length: PREVIEW_ROWS }, (_, i) => ({ no: i + 1, signer: null }))}
          attendance={{ expected: 0, actual: 0 }}
        />
        <Typography variant="helper" component="div" sx={{ mt: 1 }}>
          表格的單位、職稱、姓名會依下一步選擇的簽署人自動帶入。
        </Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button size="large" variant="outlined" href="/forms" disabled={pending}>
          取消
        </Button>
        {!locked && (
          <Button size="large" variant="contained" onClick={submit} loading={pending}>
            {isDraftOrNew ? '下一步，設定簽署' : '儲存變更'}
          </Button>
        )}
      </Box>
    </Stack>
  );
}
