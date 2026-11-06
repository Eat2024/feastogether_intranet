import { redirect } from "next/navigation";
import { ESIGN_ROUTES } from "@/constants/routes/esign";

export default function EsignPage() {
  redirect(ESIGN_ROUTES.forms.href);
}
