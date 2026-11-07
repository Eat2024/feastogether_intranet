import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/constants/routes";
import type { Metadata } from "next";

export const metadata: Metadata = { title: ROUTES.travelPermissionRoles.label };

// 佔位頁：角色管理畫面待由 CKS_Acceptance_System 移植
export default function TravelRolesPage() {
  return <PageHeader title={ROUTES.travelPermissionRoles.label} description="功能建置中。" />;
}
