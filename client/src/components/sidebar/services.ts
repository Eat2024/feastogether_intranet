import type { SvgIconComponent } from "@mui/icons-material";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import ListAltRoundedIcon from "@mui/icons-material/ListAltRounded";

/** 側邊欄第一層選單；有 children 時為群組，href 是群組底下頁面共用的路徑前綴 */
export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: SvgIconComponent;
  children?: NavSubItem[];
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
    // 電子簽路由沒有共同前綴（入口網嵌入的 EMBED_TARGET_PATHS 依賴這些路徑），逐一列出
    pathPrefixes: ["/forms", "/my-signature", "/export-history"],
    menu: [
      { key: "forms", label: "電子簽列表", href: "/forms", icon: ListAltRoundedIcon },
      { key: "my-signature", label: "我的電子簽", href: "/my-signature", icon: DrawRoundedIcon },
      {
        key: "export-history",
        label: "歷史匯出文件",
        href: "/export-history",
        icon: HistoryRoundedIcon,
      },
    ],
  },
  {
    key: "travel",
    name: "旅遊平台",
    icon: FlightTakeoffRoundedIcon,
    pathPrefixes: ["/travel"],
    menu: [
      {
        key: "permissions",
        label: "權限管理",
        href: "/travel/permissions",
        icon: AdminPanelSettingsRoundedIcon,
        children: [
          { key: "roles", label: "角色管理", href: "/travel/permissions/roles" },
          { key: "accounts", label: "帳號管理", href: "/travel/permissions/accounts" },
        ],
      },
    ],
  },
];

/** pathname 是 href 本身或其子路由（/forms 不會匹配 /forms-x） */
export function isRouteActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
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
