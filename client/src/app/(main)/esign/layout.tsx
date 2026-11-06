import Box from "@mui/material/Box";

export default function EsignLayout({ children }: LayoutProps<"/esign">) {
  return (
    <Box sx={{ flexGrow: 1, p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      {children}
    </Box>
  );
}
