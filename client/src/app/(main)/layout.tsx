import { cookies } from "next/headers";
import Box from "@mui/material/Box";
import Sidebar from "@/components/sidebar/Sidebar";
import { SIDEBAR_OPEN_COOKIE } from "@/components/sidebar/constants";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  // 在伺服器端決定側邊欄收合狀態，第一次畫面就是正確寬度
  const sidebarOpen = (await cookies()).get(SIDEBAR_OPEN_COOKIE)?.value !== "false";

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar defaultOpen={sidebarOpen} />
      <Box
        component="main"
        sx={{ flexGrow: 1, minWidth: 0, p: 3, display: "flex", flexDirection: "column", gap: 3 }}
      >
        {children}
      </Box>
    </Box>
  );
}
