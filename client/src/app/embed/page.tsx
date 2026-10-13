import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '電子簽署' };

/**
 * 入口網 iframe 的初始頁：不帶側邊欄，等入口網以 postMessage 指定要開啟的頁面
 * （由 root layout 的 EmbedBridge 處理，確認 session 是同一人後才換頁）。
 */
export default function EmbedPage() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <CircularProgress size={32} />
      <Typography variant="description">電子簽載入中…</Typography>
    </Box>
  );
}
