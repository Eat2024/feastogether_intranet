import ExternalSigning from '@/features/external-signing/ExternalSigning';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: '簽署文件' };

/**
 * 外部（Email）簽署人的簽署頁：邀請確認後由後端 303 導向此頁。
 * 不在 (main) 版面內，沒有員工側邊欄，只有深色「電子簽署」頁首；任務資料由 ExternalSigning 在瀏覽器端取得。
 */
export default async function ExternalSigningPage({ params }: PageProps<'/external-signatures/[signerPublicId]'>) {
  const { signerPublicId } = await params;

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
        <ExternalSigning signerPublicId={signerPublicId} />
      </Box>
    </Box>
  );
}
