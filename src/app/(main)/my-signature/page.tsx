import type { Metadata } from "next";
import Typography from "@mui/material/Typography";

export const metadata: Metadata = { title: "我的電子簽" };

export default function MySignaturePage() {
  return (
    <Typography variant="pageTitle">
      我的電子簽
    </Typography>
  );
}
