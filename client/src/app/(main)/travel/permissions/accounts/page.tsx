import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/constants/routes";
import type { Metadata } from "next";

export const metadata: Metadata = { title: ROUTES.travelPermissionAccounts.label };

// 佔位頁：帳號管理畫面待由 CKS_Acceptance_System 移植
export default function TravelAccountsPage() {
  return <PageHeader title={ROUTES.travelPermissionAccounts.label} description="功能建置中。" />;
}
