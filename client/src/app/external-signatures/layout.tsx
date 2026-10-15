import Box from '@mui/material/Box';

/** 外部（Email）簽署人的頁面：不顯示內部的側邊選單 */
export default function ExternalSignaturesLayout({ children }: LayoutProps<'/external-signatures'>) {
  return (
    <Box component="main" sx={{ maxWidth: 1200, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {children}
    </Box>
  );
}
