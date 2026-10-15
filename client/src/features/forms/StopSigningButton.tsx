'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import TooltipIconButton from '@/components/TooltipIconButton';
import DoDisturbIcon from '@mui/icons-material/DoDisturb';
import Button from '@mui/material/Button';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ACTION_FAILED_MESSAGE } from '@/lib/actionError';
import { stopSigning } from './actions';
import { pendingCount } from './status';
import type { EFormDoc } from './types';

/** 操作欄的「停止簽署」按鈕，點擊開啟停止簽署確認 dialog */
export default function StopSigningButton({
  form,
  disabled,
  variant = 'icon',
}: {
  form: EFormDoc;
  disabled?: boolean;
  /** icon：表格操作欄；button：頁面上的文字按鈕 */
  variant?: 'icon' | 'button';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [stopping, startTransition] = useTransition();
  const pending = pendingCount(form);

  const close = () => {
    setOpen(false);
    setError(undefined);
  };

  const handleConfirm = () => {
    if (stopping) return;
    startTransition(async () => {
      try {
        const result = await stopSigning({ formId: form.id });
        // 失敗時保留確認視窗，以說明文字顯示錯誤
        if (result?.error) {
          setError(result.error);
          return;
        }
        close();
        router.refresh();
      } catch {
        setError(ACTION_FAILED_MESSAGE);
      }
    });
  };

  return (
    <>
      {variant === 'button' ? (
        <Button
          size="large"
          variant="outlined"
          color="error"
          startIcon={<DoDisturbIcon />}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          停止簽署
        </Button>
      ) : (
        <TooltipIconButton
          label="停止簽署"
          icon={<DoDisturbIcon />}
          color="error"
          disabled={disabled}
          onClick={() => setOpen(true)}
        />
      )}
      <ConfirmDialog
        open={open}
        color="error"
        icon={<DoDisturbIcon />}
        title="停止此文件的簽署？"
        description={error ?? `「${form.name}」停止後將無法再收到新的簽署，尚未簽署的 ${pending} 人將無法再簽署此文件。`}
        confirmLabel="停止簽署"
        onConfirm={handleConfirm}
        onClose={close}
      />
    </>
  );
}
