import type { SvgIconComponent } from "@mui/icons-material";
import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import ListAltRoundedIcon from "@mui/icons-material/ListAltRounded";
import { travelMenu } from "@/constants/menu/travel";
import { TRAVEL_ROUTES } from "@/constants/routes/travel";

/** 側邊欄第一層選單；有 children 時為群組，href 是群組底下頁面共用的路徑前綴 */
export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: SvgIconComponent;
  children?: NavSubItem[];
  /** 只有網址完全相同才算目前頁（用於服務首頁，避免底下所有頁面都亮起） */
  exact?: boolean;
};

export type NavSubItem = {
  key: string;
  label: string;
  href: string;
};

/** 一個服務的側邊欄設定；新增服務只要在 SERVICES 加一筆 */
export type ServiceDefinition = {
  key: string;
  name: string;
  icon: SvgIconComponent;
  /** 屬於此服務的路徑前綴，用來從網址判斷目前所在服務 */
  pathPrefixes: string[];
  menu: NavItem[];
};

export const SERVICES: ServiceDefinition[] = [
  {
    key: "esign",
    name: "電子簽署",
    icon: DrawRoundedIcon,
    pathPrefixes: ["/esign"],
    menu: [
      { key: "forms", label: "電子簽列表", href: "/esign/forms", icon: ListAltRoundedIcon },
      { key: "my-signature", label: "我的電子簽", href: "/esign/my-signature", icon: DrawRoundedIcon },
      {
        key: "export-history",
        label: "歷史匯出文件",
        href: "/esign/export-history",
        icon: HistoryRoundedIcon,
      },
    ],
  },
  {
    key: "travel",
    name: "旅遊平台",
    icon: FlightTakeoffRoundedIcon,
    pathPrefixes: [TRAVEL_ROUTES.home.href],
    menu: travelMenu,
  },
];

/** pathname 是 href 本身或其子路由（/esign/forms 不會匹配 /esign/forms-x） */
export function isRouteActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 選單項目是否為目前頁 */
export function isNavItemActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : isRouteActive(pathname, item.href);
}

/** 點選選單項目實際前往的頁面：群組前往第一個子頁 */
export function getNavItemHref(item: NavItem) {
  return item.children?.[0]?.href ?? item.href;
}

/** 切換到某服務時前往的頁面：選單第一項 */
export function getServiceHomeHref(service: ServiceDefinition) {
  return getNavItemHref(service.menu[0]);
}

/** 依網址判斷目前服務；對不到時（例如 /）視為第一個服務 */
export function getCurrentService(pathname: string) {
  return (
    SERVICES.find((service) =>
      service.pathPrefixes.some((prefix) => isRouteActive(pathname, prefix)),
    ) ?? SERVICES[0]
  );
}
