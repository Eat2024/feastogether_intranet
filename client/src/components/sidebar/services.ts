import type { SvgIconComponent } from "@mui/icons-material";
import DrawRoundedIcon from "@mui/icons-material/DrawRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import ListAltRoundedIcon from "@mui/icons-material/ListAltRounded";
import type { AuthorizationModule } from "@/api/types";
import { filterVisibleMenu } from "@/features/navigation/filter-visible-menu";

export type NavSubItem = {
  kind: "link";
  key: string;
  label: string;
  href: string;
  moduleKey: string;
  requiredPermissions: readonly string[];
};

export type NavLink = NavSubItem & { icon: SvgIconComponent };

export type NavGroup = {
  kind: "group";
  key: string;
  label: string;
  icon: SvgIconComponent;
  children: NavSubItem[];
};

export type NavItem = NavLink | NavGroup;

export type ServiceDefinition = {
  key: string;
  name: string;
  icon: SvgIconComponent;
  pathPrefixes: string[];
  menu: NavItem[];
};

/** 前端正式使用的能力目錄；未知或跨 module 設定一律 fail closed。 */
export const KNOWN_NAVIGATION_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  esign: ["esign.document.read", "esign.signing.read", "esign.export.read"],
};

/** 只列目前有實際業務流程的入口；旅遊權限隔離以測試 fixture 驗證，不建立正式假入口。 */
export const SERVICES: ServiceDefinition[] = [
  {
    key: "esign",
    name: "電子簽署",
    icon: DrawRoundedIcon,
    pathPrefixes: ["/esign"],
    menu: [
      {
        kind: "link", key: "forms", label: "電子簽列表", href: "/esign/forms",
        icon: ListAltRoundedIcon, moduleKey: "esign", requiredPermissions: ["esign.document.read"],
      },
      {
        kind: "link", key: "my-signature", label: "我的電子簽", href: "/esign/my-signature",
        icon: DrawRoundedIcon, moduleKey: "esign", requiredPermissions: ["esign.signing.read"],
      },
      {
        kind: "link", key: "export-history", label: "歷史匯出文件", href: "/esign/export-history",
        icon: HistoryRoundedIcon, moduleKey: "esign", requiredPermissions: ["esign.export.read"],
      },
    ],
  },
];

export function getVisibleServices(modules: readonly AuthorizationModule[]): ServiceDefinition[] {
  return SERVICES.flatMap((service) => {
    const menu = filterVisibleMenu(service.menu, modules, KNOWN_NAVIGATION_PERMISSIONS);
    return menu.length ? [{ ...service, menu }] : [];
  });
}

export function isRouteActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getNavItemHref(item: NavItem) {
  return item.kind === "group" ? item.children[0]?.href ?? "/" : item.href;
}

export function isNavItemActive(pathname: string, item: NavItem) {
  return item.kind === "group"
    ? item.children.some((child) => isRouteActive(pathname, child.href))
    : isRouteActive(pathname, item.href);
}

export function getServiceHomeHref(service: ServiceDefinition) {
  return getNavItemHref(service.menu[0]);
}

export function getCurrentService(pathname: string, services: readonly ServiceDefinition[]) {
  return services.find((service) =>
    service.pathPrefixes.some((prefix) => isRouteActive(pathname, prefix)),
  ) ?? services[0];
}
