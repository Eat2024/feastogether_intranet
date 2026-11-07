import { ROUTES } from "@/constants/routes";
import { redirect } from "next/navigation";

// 旅遊平台尚無首頁，先導向權限管理
export default function TravelPage() {
  redirect(ROUTES.travelPermissionRoles.href);
}
