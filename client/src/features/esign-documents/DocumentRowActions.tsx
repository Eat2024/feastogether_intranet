'use client';

// 列表的操作按鈕：與原本列表相同的圖示與順序。對應的頁面與 API 尚未串接後端，先停用並說明原因。
import TooltipIconButton from '@/components/TooltipIconButton';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DoDisturbIcon from '@mui/icons-material/DoDisturb';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import EventRepeatRoundedIcon from '@mui/icons-material/EventRepeatRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

const ACTIONS: { label: string; icon: ReactNode }[] = [
  { label: '發起簽署', icon: <SendRoundedIcon /> },
  { label: '檢視', icon: <VisibilityRoundedIcon /> },
  { label: '匯出', icon: <FileDownloadRoundedIcon /> },
  { label: '編輯', icon: <EditRoundedIcon /> },
  { label: '補簽', icon: <EventRepeatRoundedIcon /> },
  { label: '停止簽署', icon: <DoDisturbIcon /> },
  { label: '刪除', icon: <DeleteOutlineRoundedIcon /> },
];

// TODO: 串接文件詳情、編輯、發起、停止、刪除等 API 後，依文件狀態啟用對應的操作
export default function DocumentRowActions() {
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {ACTIONS.map((a) => (
        <TooltipIconButton key={a.label} label={`${a.label}（尚未串接後端）`} icon={a.icon} disabled />
      ))}
    </Box>
  );
}
