export const ROUTES = {
  home: { href: "/", label: "首頁" },
  esign: { href: "/esign", label: "電子簽署" },
  esignForms: { href: "/esign/forms", label: "電子簽列表" },
  esignFormsNew: { href: "/esign/forms/new", label: "新增電子簽文件" },
  esignMySignature: { href: "/esign/my-signature", label: "我的電子簽" },
  esignExportHistory: { href: "/esign/export-history", label: "歷史匯出文件" },
  travel: { href: "/travel", label: "旅遊平台" },
  travelPermissions: { href: "/travel/permissions", label: "權限管理" },
  travelPermissionRoles: { href: "/travel/permissions/roles", label: "角色管理" },
  travelPermissionAccounts: { href: "/travel/permissions/accounts", label: "帳號管理" },
} as const;

/** 路徑與顯示名稱的唯一對照，供 Breadcrumb 與導覽設定共用。 */
export const ROUTE_LABEL_MAP = Object.values(ROUTES).reduce<Record<string, string>>(
  (labels, route) => {
    labels[route.href] = route.label;
    return labels;
  },
  {},
);

export function getBreadcrumbItems(pathname: string) {
  const paths = pathname.split('/').filter(Boolean);
  return [
    { label: ROUTE_LABEL_MAP['/'] ?? '首頁', href: '/' },
    ...paths.map((_, index) => {
      const href = `/${paths.slice(0, index + 1).join('/')}`;
      return { label: ROUTE_LABEL_MAP[href] ?? href, href };
    }),
  ];
}
