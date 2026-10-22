import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

/**
 * 不需員工登入的公開頁面（外部簽署、簽章驗證）的外框：
 * 不在 (main) 版面內，沒有員工側邊欄，只有深色「電子簽署」頁首。
 */
export default function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box
        component="header"
        sx={{
          height: { xs: 56, sm: 64 },
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          px: { xs: 2, sm: 3 },
          bgcolor: 'navBg',
        }}
      >
        <Typography variant="sectionTitle" component="div" sx={{ color: 'common.white' }}>
          電子簽署
        </Typography>
      </Box>
      <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>
    </Box>
  );
}
