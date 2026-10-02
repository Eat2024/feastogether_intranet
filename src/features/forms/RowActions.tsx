'use client';

// 必須是 client 元件：圖示元素若在伺服器元件建立再傳給 IconButton，
// dev 模式下會觸發 React 的 key 警告（同 TooltipIconButton 的 Tooltip 問題）
import TooltipIconButton from '@/components/TooltipIconButton';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Box from '@mui/material/Box';
import DeleteFormButton from './DeleteFormButton';
import StopSigningButton from './StopSigningButton';
import { deriveStatus, signedCount } from './status';
import type { EFormDoc } from './types';

// 操作按鈕一律全部列出、順序固定，依狀態停用（可操作為 info 色、停止簽署為 error 色，停用為灰）；規則沿用 req_doc/forms-admin.html
export default function RowActions({ form }: { form: EFormDoc }) {
  const status = deriveStatus(form);
  const signed = signedCount(form);

  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      <TooltipIconButton
        label="發起簽署"
        icon={<SendRoundedIcon />}
        color="info"
        href={`/forms/${form.id}/signers`}
        disabled={status !== 'draft'}
      />
      {/* 檢視簽署狀態與通知簽署人（草稿尚無進度，停用） */}
      <TooltipIconButton
        label="檢視"
        icon={<VisibilityRoundedIcon />}
        color="info"
        href={`/forms/${form.id}`}
        disabled={status === 'draft'}
      />
      <TooltipIconButton
        label="編輯"
        icon={<EditRoundedIcon />}
        color="info"
        href={`/forms/${form.id}/edit`}
        disabled={signed !== 0 || status === 'stopped'}
      />
      <StopSigningButton form={form} disabled={status !== 'active'} />
      <DeleteFormButton form={form} disabled={signed !== 0} />
    </Box>
  );
}
