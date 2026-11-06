import PageHeader from "@/components/PageHeader";
import { TRAVEL_ROUTES } from "@/constants/routes/travel";
import type { Metadata } from "next";

const route = TRAVEL_ROUTES.registrationSettings;

export const metadata: Metadata = { title: route.label };

// 佔位頁：畫面待建置
export default function RegistrationSettingsPage() {
  return <PageHeader title={route.label} description="功能建置中。" />;
}
