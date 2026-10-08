'use client';

import TooltipIconButton from '@/components/TooltipIconButton';
import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { zhTW } from '@mui/x-date-pickers/locales';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-tw';
import { useState, useTransition } from 'react';
import { reopenSigning } from './actions';
import { RESIGN_REASON_MAX, validateResign } from './resign';
import { pendingCount } from './status';
import type { EFormDoc } from './types';

// 資料格式 YYYY/MM/DD
const FORMAT = 'YYYY/MM/DD';
// 補簽期間預設一週
const DEFAULT_DAYS = 7;

/** 操作欄的「補簽」按鈕：設定補簽期間與原因後重新開放未簽署者簽署 */
export default function ResignButton({ form, disabled }: { form: EFormDoc; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<Dayjs | null>(null);
  const [end, setEnd] = useState<Dayjs | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const waiting = pendingCount(form);

  const openDialog = () => {
    const today = dayjs().startOf('day');
    setStart(today);
    setEnd(today.add(DEFAULT_DAYS, 'day'));
    setReason('');
    setTouched(false);
    setError(null);
    setOpen(true);
  };
  const close = () => {
    if (!pending) setOpen(false);
  };

  const input = {
    startAt: start?.isValid() ? start.format(FORMAT) : '',
    endAt: end?.isValid() ? end.format(FORMAT) : '',
    reason,
  };
  // 與 server 相同的規則；送出時 server 會再檢查一次
  const checked = validateResign(input, dayjs().format(FORMAT));
  const invalid = 'error' in checked ? checked.error : null;
  const reasonLength = Array.from(reason.trim()).length;

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    setError(null);
    startTransition(async () => {
      const res = await reopenSigning({ formId: form.id, ...input });
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setDone(`已開放補簽，${res.pending} 位未簽署者可於 ${input.startAt} ～ ${input.endAt} 簽署`);
    });
  };

  return (
    <>
      <TooltipIconButton
        label="補簽"
        icon={<EventRepeatRoundedIcon />}
        color="info"
        disabled={disabled}
        onClick={openDialog}
      />
      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>補簽「{form.name}」</DialogTitle>
        <Divider />
        <DialogContent>
          <LocalizationProvider
            dateAdapter={AdapterDayjs}
            adapterLocale="zh-tw"
            localeText={zhTW.components.MuiLocalizationProvider.defaultProps.localeText}
          >
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              <Typography variant="description">
                原簽署期間 {form.startAt ?? '—'} ～ {form.endAt ?? '不限'}，目前尚有 {waiting} 位未簽署。
                確定後將重新開放這些人在補簽期間內簽署；已簽署與已拒絕的人不受影響。
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <DatePicker
                  label="補簽開始日"
                  value={start}
                  minDate={dayjs()}
                  maxDate={end ?? undefined}
                  onChange={setStart}
                  format={FORMAT}
                  disabled={pending}
                  slotProps={{ textField: { size: 'small', sx: { width: 188 } } }}
                />
                <Typography variant="secondary" component="span">
                  ～
                </Typography>
                <DatePicker
                  label="補簽結束日"
                  value={end}
                  minDate={start ?? dayjs()}
                  onChange={setEnd}
                  format={FORMAT}
                  disabled={pending}
                  slotProps={{ textField: { size: 'small', sx: { width: 188 } } }}
                />
              </Box>
              <TextField
                label="補簽原因"
                required
                multiline
                minRows={3}
                value={reason}
                disabled={pending}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例如：部分門市同仁休假，延長簽署期限"
                error={touched && !reason.trim()}
                helperText={`${reasonLength}/${RESIGN_REASON_MAX}`}
                slotProps={{ formHelperText: { sx: { textAlign: 'right', mx: 0 } } }}
              />
              {touched && (error ?? invalid) && <Alert severity="error">{error ?? invalid}</Alert>}
            </Stack>
          </LocalizationProvider>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button variant="outlined" onClick={close} disabled={pending}>
            取消
          </Button>
          <Button variant="contained" startIcon={<EventRepeatRoundedIcon />} loading={pending} onClick={submit}>
            確定補簽
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={!!done}
        autoHideDuration={4000}
        onClose={() => setDone(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setDone(null)}>
          {done}
        </Alert>
      </Snackbar>
    </>
  );
}
