import Box from "@mui/material/Box";
import SideNav from "@/components/SideNav";

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <SideNav />
      <Box
        component="main"
        sx={{ flexGrow: 1, minWidth: 0, p: 3, display: "flex", flexDirection: "column", gap: 3 }}
      >
        {children}
      </Box>
    </Box>
  );
}
