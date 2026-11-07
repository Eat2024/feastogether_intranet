import { cookies } from "next/headers";
import Box from "@mui/material/Box";
import UserProfile from "@/components/UserProfile";
import Sidebar from "@/components/sidebar/Sidebar";
import { SIDEBAR_OPEN_COOKIE } from "@/components/sidebar/constants";
import InternalIdentityBoundary from "@/features/navigation/InternalIdentityBoundary";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  // 在伺服器端決定側邊欄收合狀態，第一次畫面就是正確寬度
  const sidebarOpen = (await cookies()).get(SIDEBAR_OPEN_COOKIE)?.value !== "false";

  return (
    <InternalIdentityBoundary>
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar defaultOpen={sidebarOpen} />
        <Box
          component="main"
          sx={{ flexGrow: 1, minWidth: 0, p: 3, display: "flex", flexDirection: "column", gap: 3 }}
        >
          <Box component="header" sx={{ display: "flex", justifyContent: "flex-end" }}>
            <UserProfile />
          </Box>
          {children}
        </Box>
      </Box>
    </InternalIdentityBoundary>
  );
}
