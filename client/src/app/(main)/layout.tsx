import { esignRequest } from '@/lib/api/esign';
import SessionExpiry from '@/features/auth/SessionExpiry';
import Box from "@mui/material/Box";
import SideNav from "@/components/SideNav";
import { isAdmin } from "@/features/export-history/admin";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  const session = await esignRequest<{ expiresAt: string }>('/auth/session');
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <SessionExpiry expiresAt={session.expiresAt} />
      <SideNav isAdmin={isAdmin()} />
      <Box
        component="main"
        sx={{ flexGrow: 1, minWidth: 0, p: 3, display: "flex", flexDirection: "column", gap: 3 }}
      >
        {children}
      </Box>
    </Box>
  );
}
