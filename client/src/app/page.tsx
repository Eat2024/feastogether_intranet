import { redirect } from "next/navigation";
import { ESIGN_ROUTES } from "@/constants/routes/esign";

export default function Home() {
  redirect(ESIGN_ROUTES.forms.href);
}
