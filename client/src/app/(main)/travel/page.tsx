import PageHeader from "@/components/PageHeader";
import { TRAVEL_ROUTES } from "@/constants/routes/travel";
import type { Metadata } from "next";

const route = TRAVEL_ROUTES.home;

export const metadata: Metadata = { title: route.label };

// 佔位頁：旅遊平台首頁待設計
export default function TravelHomePage() {
  return <PageHeader title={route.label} description="功能建置中。" />;
}
