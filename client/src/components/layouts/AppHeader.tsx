import Box from '@mui/material/Box';
import UserProfile from './UserProfile';
import PageBreadcrumbs from './PageBreadcrumbs';

export default function AppHeader() {
  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: 56,
        flexShrink: 0,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderBottomColor: 'divider',
        pl: 6,
        pr: 4,
      }}
    >
      <PageBreadcrumbs />
      <UserProfile />
    </Box>
  );
}
