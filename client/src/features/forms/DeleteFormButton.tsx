'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import TooltipIconButton from '@/components/TooltipIconButton';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import { useState } from 'react';
import type { EFormDoc } from './types';

/** 操作欄的「刪除」按鈕，點擊開啟刪除確認 dialog */
export default function DeleteFormButton({
  form,
  disabled,
}: {
  form: EFormDoc;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const handleConfirm = () => {
    // TODO: 串接刪除 API 後重新取得列表
    setOpen(false);
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
        description={`「${form.name}」尚無人簽署，刪除後無法復原。`}
        confirmLabel="刪除"
        onConfirm={handleConfirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
