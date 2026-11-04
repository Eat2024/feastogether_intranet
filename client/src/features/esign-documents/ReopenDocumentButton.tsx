'use client';

// 補簽：已到期且仍有人未簽署時，設定新的截止日與原因，呼叫 POST /api/esign/documents/:id/reopenings。
// 只延後截止時間，原開始時間與已完成的簽署不變；每次補簽都會記在簽署歷程中。
// 成功後後端自動寄送新的邀請信給所有未簽署者（Spec 010），寄送結果見通知紀錄。
import { queryKeys } from '@/api/query-keys';
import { reopenDocument } from '@/api/requests';
import type { EsignDocumentListItem } from '@/api/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import TooltipIconButton from '@/components/TooltipIconButton';
import { getErrorMessage } from '@/lib/apiError';
import { dayBoundary } from '@/lib/dates';
import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { zhTW } from '@mui/x-date-pickers/locales';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-tw';
import { useState } from 'react';
import { formatDateTime } from './listQuery';

const DATE_FORMAT = 'YYYY/MM/DD';
// 新截止日預設為一週後
const DEFAULT_EXTENSION_DAYS = 7;
// 後端限制（server/src/features/esign/dto/reopening.dto.ts）
const MAX_REASON = 500;

type ReopenDocument = Pick<EsignDocumentListItem, 'id' | 'title' | 'pendingCount' | 'signEndAt'>;

/** variant="button" 用於檢視頁頁首，預設為列表操作欄的圖示按鈕 */
export default function ReopenDocumentButton({
  doc,
  disabled,
  variant = 'icon',
}: {
  doc: ReopenDocument;
  disabled?: boolean;
  variant?: 'icon' | 'button';
}) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [deadline, setDeadline] = useState<Dayjs | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENTS] });
    void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT, doc.id] });
  };
  const reopen = useMutation({
    mutationFn: reopenDocument,
    // 錯誤顯示在對話框內
    meta: { suppressGlobalErrorToast: true },
    onSuccess: (result) => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT_HISTORY, doc.id] });
      // 補簽會建立新的邀請通知批次
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_NOTIFICATION_BATCHES, doc.id] });
      setOpen(false);
      showSnackbar(
        `已開放「${doc.title}」補簽，${result.pendingCount} 位未簽署者可繼續簽署，有效信箱將收到通知，可簽至 ${formatDateTime(result.signEndAt)}`,
        'success',
      );
    },
    // 409 表示畫面上的期限已被變更：重新取得資料，讓使用者確認最新狀態
    onError: refresh,
  });

  const trimmedReason = reason.trim();
  const reasonLength = Array.from(trimmedReason).length;
  const deadlineIso = deadline?.isValid() ? dayBoundary(deadline.format(DATE_FORMAT), 'end') : null;
  // 與後端相同的規則：新截止時間須晚於現在與目前截止時間
  const deadlineInvalid =
    !deadlineIso ||
    new Date(deadlineIso) <= new Date() ||
    (doc.signEndAt !== null && new Date(deadlineIso) <= new Date(doc.signEndAt));
  const reasonInvalid = !trimmedReason || reasonLength > MAX_REASON;
  const deadlineError = touched && deadlineInvalid ? '新的截止日必須晚於目前期限與今天' : undefined;
  const reasonError = touched && reasonInvalid ? `請填寫 1～${MAX_REASON} 字的補簽原因` : undefined;

  const openDialog = () => {
    setDeadline(dayjs().add(DEFAULT_EXTENSION_DAYS, 'day').startOf('day'));
    setReason('');
    setTouched(false);
    reopen.reset();
    setOpen(true);
  };

  const confirm = () => {
    setTouched(true);
    if (!doc.signEndAt || !deadlineIso || deadlineInvalid || reasonInvalid) return;
    reopen.mutate({ id: doc.id, expectedSignEndAt: doc.signEndAt, signEndAt: deadlineIso, reason: trimmedReason });
  };

  return (
    <>
      {variant === 'button' ? (
        <Button
          size="large"
          variant="contained"
          startIcon={<EventRepeatRoundedIcon />}
          disabled={disabled}
          onClick={openDialog}
        >
          補簽
        </Button>
      ) : (
        <TooltipIconButton
          label="補簽"
          icon={<EventRepeatRoundedIcon />}
          color="info"
          disabled={disabled}
          onClick={openDialog}
        />
      )}
      <ConfirmDialog
        open={open}
        icon={<EventRepeatRoundedIcon />}
        title={`重新開放「${doc.title}」補簽？`}
        description={`目前尚有 ${doc.pendingCount} 位未簽署。補簽只會延後截止時間，原開始時間與已完成的簽署不變；確定後系統會通知有有效信箱的未簽署者；無信箱的內部員工請由人資另行通知自行登入入口網簽署。`}
        confirmLabel="確定補簽"
        loading={reopen.isPending}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      >
        <LocalizationProvider
          dateAdapter={AdapterDayjs}
          adapterLocale="zh-tw"
          localeText={zhTW.components.MuiLocalizationProvider.defaultProps.localeText}
        >
          <Stack spacing={2}>
            <Typography variant="helper">原截止時間：{formatDateTime(doc.signEndAt) ?? '—'}</Typography>
            <DatePicker
              label="新的截止日"
              value={deadline}
              minDate={dayjs()}
              format={DATE_FORMAT}
              disabled={reopen.isPending}
              onChange={setDeadline}
              slotProps={{
                textField: {
                  fullWidth: true,
                  error: !!deadlineError,
                  helperText: deadlineError ?? '截止時間為所選日期的 23:59',
                },
              }}
            />
            <TextField
              fullWidth
              multiline
              minRows={3}
              required
              label="補簽原因"
              placeholder="例如：部分同仁休假，延長簽署期限"
              value={reason}
              disabled={reopen.isPending}
              onChange={(e) => setReason(Array.from(e.target.value).slice(0, MAX_REASON).join(''))}
              onBlur={() => setTouched(true)}
              error={!!reasonError}
              helperText={reasonError ?? `${reasonLength}/${MAX_REASON}；每次補簽都會記在簽署歷程中`}
            />
            {reopen.isError && (
              <Alert severity="error">{getErrorMessage(reopen.error, '補簽失敗，請稍後再試')}</Alert>
            )}
          </Stack>
        </LocalizationProvider>
      </ConfirmDialog>
    </>
  );
}
