'use client';

// 列表的操作按鈕：與原本列表相同的圖示與順序，依文件狀態停用。
import type { EsignDocumentListItem } from '@/api/types';
import TooltipIconButton from '@/components/TooltipIconButton';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Box from '@mui/material/Box';
import DeleteDocumentButton from './DeleteDocumentButton';
import ReopenDocumentButton from './ReopenDocumentButton';
import StopDocumentButton from './StopDocumentButton';

export default function DocumentRowActions({
  doc,
}: {
  doc: Pick<EsignDocumentListItem, 'id' | 'title' | 'status' | 'pendingCount' | 'signEndAt'>;
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
      {/* 已到期且仍有人未簽署才能補簽 */}
      <ReopenDocumentButton doc={doc} disabled={doc.status !== 'expired' || doc.pendingCount === 0} />
      {/* 簽署中、已到期才能停止 */}
      <StopDocumentButton doc={doc} disabled={doc.status !== 'active' && doc.status !== 'expired'} />
      {/* 後端只允許刪除尚未發起的草稿 */}
      <DeleteDocumentButton doc={doc} disabled={doc.status !== 'draft'} />
    </Box>
  );
}
