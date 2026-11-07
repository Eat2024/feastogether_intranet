import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import Sidebar from '@/components/sidebar/Sidebar';
import AppHeader from './AppHeader';

export default function AppShell({
  children,
  sidebarOpen,
}: {
  children: ReactNode;
  sidebarOpen: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', height: '100vh' }}>
      <Sidebar defaultOpen={sidebarOpen} />
      <Box
        component="main"
        sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, bgcolor: 'background.default' }}
      >
        <AppHeader />
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'auto', p: 3, gap: 3 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
