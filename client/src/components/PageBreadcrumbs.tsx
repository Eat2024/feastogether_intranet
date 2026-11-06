"use client";

import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  /** 服務首頁，麵包屑第一層 */
  homeHref: string;
  /** 路徑與名稱對照（例如 TRAVEL_ROUTE_LABEL_MAP） */
  labels: Record<string, string>;
};

/** 依網址逐層列出名稱（比照 CKS_Acceptance_System 的 PageBreadcrumbs）；對照表沒有的層級直接顯示路徑 */
function getBreadcrumbItems(pathname: string, homeHref: string, labels: Record<string, string>) {
  const homeDepth = homeHref.split("/").filter(Boolean).length;
  const paths = pathname.split("/").filter(Boolean);

  return [
    { label: labels[homeHref] ?? "首頁", href: homeHref },
    ...paths.slice(homeDepth).map((_, index) => {
      const href = "/" + paths.slice(0, homeDepth + index + 1).join("/");
      return { label: labels[href] ?? href, href };
    }),
  ];
}

export default function PageBreadcrumbs({ homeHref, labels }: Props) {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumbItems(pathname, homeHref, labels);

  return (
    <Breadcrumbs aria-label="麵包屑" sx={{ typography: "body2" }}>
      {breadcrumbs.map((item, index) =>
        index === breadcrumbs.length - 1 ? (
          <Typography key={item.href} variant="body2" color="textPrimary" aria-current="page">
            {item.label}
          </Typography>
        ) : (
          <Link key={item.href} component={NextLink} href={item.href} underline="hover" color="inherit">
            {item.label}
          </Link>
        ),
      )}
    </Breadcrumbs>
  );
}
