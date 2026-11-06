import Box from "@mui/material/Box";
import PageBreadcrumbs from "@/components/PageBreadcrumbs";
import { TRAVEL_ROUTES, TRAVEL_ROUTE_LABEL_MAP } from "@/constants/routes/travel";

export default function TravelLayout({ children }: LayoutProps<"/travel">) {
  return (
    <>
      {/* 頂列比照 CKS 的 AppHeader，捲動時固定在上方 */}
      <Box
        component="header"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: "appBar",
          display: "flex",
          alignItems: "center",
          minHeight: 56,
          px: 3,
          bgcolor: "background.paper",
          borderBottom: "1px solid",
          borderBottomColor: "divider",
        }}
      >
        <PageBreadcrumbs homeHref={TRAVEL_ROUTES.home.href} labels={TRAVEL_ROUTE_LABEL_MAP} />
      </Box>
      <Box sx={{ flexGrow: 1, p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
        {children}
      </Box>
    </>
  );
}
