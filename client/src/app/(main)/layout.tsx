import { cookies } from "next/headers";
import AppShell from "@/components/layouts/AppShell";
import { SIDEBAR_OPEN_COOKIE } from "@/components/sidebar/constants";
import InternalIdentityBoundary from "@/features/navigation/InternalIdentityBoundary";
import PermissionProvider from "@/providers/PermissionProvider";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  // 在伺服器端決定側邊欄收合狀態，第一次畫面就是正確寬度
  const sidebarOpen = (await cookies()).get(SIDEBAR_OPEN_COOKIE)?.value !== "false";

  return (
    <InternalIdentityBoundary>
      <PermissionProvider>
        <AppShell sidebarOpen={sidebarOpen}>{children}</AppShell>
      </PermissionProvider>
    </InternalIdentityBoundary>
  );
}
