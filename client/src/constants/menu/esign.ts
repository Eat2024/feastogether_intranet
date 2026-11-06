import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import ListAltRoundedIcon from "@mui/icons-material/ListAltRounded";
import type { NavItem } from "@/components/sidebar/services";
import { ESIGN_ROUTES } from "@/constants/routes/esign";

/** 電子簽側邊欄選單（比照 CKS_Acceptance_System 的 constants/menu.ts，由 ESIGN_ROUTES 組成） */
export const esignMenu: NavItem[] = [
  {
    key: "forms",
    label: ESIGN_ROUTES.forms.label,
    href: ESIGN_ROUTES.forms.href,
    icon: ListAltRoundedIcon,
  },
  {
    key: "my-signature",
    label: ESIGN_ROUTES.mySignature.label,
    href: ESIGN_ROUTES.mySignature.href,
    icon: DrawRoundedIcon,
  },
  {
    key: "export-history",
    label: ESIGN_ROUTES.exportHistory.label,
    href: ESIGN_ROUTES.exportHistory.href,
    icon: HistoryRoundedIcon,
  },
];
