import { redirect } from "next/navigation";
import { TRAVEL_ROUTES } from "@/constants/routes/travel";

// 群組本身沒有畫面，導向第一個子功能
export default function VotingManagementPage() {
  redirect(TRAVEL_ROUTES.votingEventSettings.href);
}
