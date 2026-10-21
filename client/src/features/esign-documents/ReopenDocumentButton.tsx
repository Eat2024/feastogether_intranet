"use client";

import { queryKeys } from "@/api/query-keys";
import { reopenDocument } from "@/api/requests";
import type { EsignDocumentListItem } from "@/api/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useSnackbar } from "@/components/providers/SnackbarProvider";
import TooltipIconButton from "@/components/TooltipIconButton";
import { getErrorMessage } from "@/lib/apiError";
import { formatTaipeiDateTime, taipeiDayBoundary } from "@/lib/dates";
import EventRepeatRoundedIcon from "@mui/icons-material/EventRepeatRounded";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { zhTW } from "@mui/x-date-pickers/locales";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-tw";
import { useState } from "react";

const DATE_FORMAT = "YYYY/MM/DD";
const DEFAULT_EXTENSION_DAYS = 7;
const MAX_REASON = 500;

type ReopenDocument = Pick<
  EsignDocumentListItem,
  "id" | "title" | "status" | "pendingCount" | "signEndAt"
>;

export default function ReopenDocumentButton({
  doc,
  disabled,
  variant = "icon",
}: {
  doc: ReopenDocument;
  disabled?: boolean;
  variant?: "icon" | "button";
}) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [deadline, setDeadline] = useState<Dayjs | null>(null);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const reopen = useMutation({
    mutationFn: reopenDocument,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENTS],
      });
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENT, doc.id],
      });
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENT_HISTORY, doc.id],
      });
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_NOTIFICATION_BATCHES, doc.id],
      });
      setOpen(false);
      showSnackbar(
        `已開放「${doc.title}」補簽，${result.pendingCount} 位待簽署者可簽至 ${formatTaipeiDateTime(result.signEndAt)}`,
        "success",
      );
    },
    onError: () => {
      // 409 代表畫面上的期限已過時；先刷新資料，讓使用者重新確認最新狀態。
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENTS],
      });
      void queryClient.invalidateQueries({
        queryKey: [queryKeys.ESIGN_DOCUMENT, doc.id],
      });
    },
  });

  const trimmedReason = reason.trim();
  const reasonLength = Array.from(trimmedReason).length;
  const deadlineIso = deadline?.isValid()
    ? taipeiDayBoundary(deadline.format(DATE_FORMAT), "end")
    : null;
  const deadlineInvalid =
    !deadlineIso ||
    new Date(deadlineIso) <= new Date() ||
    (doc.signEndAt !== null &&
      new Date(deadlineIso) <= new Date(doc.signEndAt));
  const reasonInvalid = !trimmedReason || reasonLength > MAX_REASON;
  const deadlineError =
    touched && deadlineInvalid
      ? "新截止日必須晚於目前期限及現在時間"
      : undefined;
  const reasonError =
    touched && reasonInvalid
      ? `請填寫 1 至 ${MAX_REASON} 字的補簽原因`
      : undefined;

  const openDialog = () => {
    setDeadline(dayjs().add(DEFAULT_EXTENSION_DAYS, "day").startOf("day"));
    setReason("");
    setTouched(false);
    reopen.reset();
    setOpen(true);
  };

  const confirm = () => {
    setTouched(true);
    if (!doc.signEndAt || !deadlineIso || deadlineInvalid || reasonInvalid)
      return;
    reopen.mutate({
      id: doc.id,
      expectedSignEndAt: doc.signEndAt,
      signEndAt: deadlineIso,
      reason: trimmedReason,
    });
  };

  const trigger =
    variant === "button" ? (
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
    );

  return (
    <>
      {trigger}
      <ConfirmDialog
        open={open}
        icon={<EventRepeatRoundedIcon />}
        title={`重新開放「${doc.title}」補簽？`}
        description={`目前尚有 ${doc.pendingCount} 位未簽署。補簽只會更新截止時間，原開始時間及已完成的簽署證據不變。`}
        confirmLabel="確定補簽"
        loading={reopen.isPending}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      >
        <LocalizationProvider
          dateAdapter={AdapterDayjs}
          adapterLocale="zh-tw"
          localeText={
            zhTW.components.MuiLocalizationProvider.defaultProps.localeText
          }
        >
          <Stack spacing={2}>
            <Typography variant="helper">
              原截止時間：
              {doc.signEndAt ? formatTaipeiDateTime(doc.signEndAt) : "—"}
            </Typography>
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
                  helperText:
                    deadlineError ?? "截止時間為所選日期的台北時間 23:59",
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
              onChange={(event) =>
                setReason(
                  Array.from(event.target.value).slice(0, MAX_REASON).join(""),
                )
              }
              onBlur={() => setTouched(true)}
              error={!!reasonError}
              helperText={
                reasonError ??
                `${reasonLength}/${MAX_REASON}；每次補簽都會保留在歷程中`
              }
            />
            {reopen.isError && (
              <Alert severity="error">
                {getErrorMessage(reopen.error, "補簽失敗，請稍後再試")}
              </Alert>
            )}
          </Stack>
        </LocalizationProvider>
      </ConfirmDialog>
    </>
  );
}
