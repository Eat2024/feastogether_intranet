'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import TooltipIconButton from '@/components/TooltipIconButton';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ACTION_FAILED_MESSAGE } from '@/lib/actionError';
import { deleteDocument } from './actions';
import type { EFormDoc } from './types';

/** 操作欄的「刪除」按鈕，點擊開啟刪除確認 dialog */
export default function DeleteFormButton({
  form,
  disabled,
}: {
  form: EFormDoc;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [deleting, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setError(undefined);
  };

  const handleConfirm = () => {
    if (deleting) return;
    startTransition(async () => {
      try {
        const result = await deleteDocument({ formId: form.id });
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
      <TooltipIconButton
        label="刪除"
        icon={<DeleteOutlineRoundedIcon />}
        color="error"
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      <ConfirmDialog
        open={open}
        color="error"
        icon={<DeleteRoundedIcon />}
        title="刪除此文件？"
        description={error ?? `「${form.name}」尚無人簽署，刪除後無法復原。`}
        confirmLabel="刪除"
        onConfirm={handleConfirm}
        onClose={close}
      />
    </>
  );
}
