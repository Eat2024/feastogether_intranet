'use client';

// 列表的操作按鈕：與原本列表相同的圖示與順序。尚未串接後端的操作先停用並說明原因。
import type { EsignDocumentListItem } from '@/api/types';
import TooltipIconButton from '@/components/TooltipIconButton';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import DeleteDocumentButton from './DeleteDocumentButton';
import StopDocumentButton from './StopDocumentButton';

// 尚未串接的操作
const NOT_CONNECTED: { label: string; icon: ReactNode }[] = [
  { label: '補簽', icon: <EventRepeatRoundedIcon /> },
];

// TODO: 串接補簽 API 後，依文件狀態啟用
export default function DocumentRowActions({
  doc,
}: {
  doc: Pick<EsignDocumentListItem, 'id' | 'title' | 'status' | 'pendingCount'>;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {/* 草稿才能前往設定簽署並發起 */}
      <TooltipIconButton
        label="發起簽署"
        icon={<SendRoundedIcon />}
        color="info"
        href={`/forms/${doc.id}/signers`}
        disabled={doc.status !== 'draft'}
      />
      {/* 檢視簽署進度與歷程（草稿尚無進度，停用） */}
      <TooltipIconButton
        label="檢視"
        icon={<VisibilityRoundedIcon />}
        color="info"
        href={`/forms/${doc.id}`}
        disabled={doc.status === 'draft'}
      />
      {/* 匯出簽署紀錄（草稿尚無簽署資料，停用） */}
      <TooltipIconButton
        label="匯出"
        icon={<FileDownloadRoundedIcon />}
        color="info"
        href={`/forms/${doc.id}/export`}
        disabled={doc.status === 'draft'}
      />
      {/* 後端只允許修改尚未發起的草稿 */}
      <TooltipIconButton
        label={doc.status === 'draft' ? '編輯' : '編輯（已發起的文件無法修改）'}
        icon={<EditRoundedIcon />}
        color="info"
        href={`/forms/${doc.id}/edit`}
        disabled={doc.status !== 'draft'}
      />
      {NOT_CONNECTED.map((a) => (
        <TooltipIconButton key={a.label} label={`${a.label}（尚未串接後端）`} icon={a.icon} disabled />
      ))}
      {/* 簽署中（含已過結束時間仍有人未簽、畫面顯示為已到期）才能停止 */}
      <StopDocumentButton doc={doc} disabled={doc.status !== 'active'} />
      {/* 後端只允許刪除尚未發起的草稿 */}
      <DeleteDocumentButton doc={doc} disabled={doc.status !== 'draft'} />
    </Box>
  );
}
