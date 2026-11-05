import Box from "@mui/material/Box";
import Sidebar from "@/components/sidebar/Sidebar";

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <Box
        component="main"
        sx={{ flexGrow: 1, minWidth: 0, p: 3, display: "flex", flexDirection: "column", gap: 3 }}
      >
        {children}
      </Box>
    </Box>
  );
}
