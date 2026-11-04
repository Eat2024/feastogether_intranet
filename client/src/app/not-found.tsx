import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import Image from "next/image";
import { color, fontSize, fontWeight } from "@/theme/tokens";

// 覆蓋 root layout 的標題與描述，不透露這是電子簽系統
export const metadata: Metadata = { title: "404 找不到網站", description: null };

/** 未登入的員工頁面與不存在的網址共用：只顯示饗賓 LOGO 與「404 找不到網站」，不提供其他資訊。 */
export default function NotFound() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 2,
        py: 4,
        bgcolor: color.brandCanvas,
      }}
    >
      <Box
        component="main"
        sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, textAlign: "center" }}
      >
        <Box
          component={Image}
          src="/feastogether-logo.png"
          alt="饗賓餐旅事業 Feastogether Corporation"
          width={720}
          height={181}
          priority
          sx={{ display: "block", width: "min(320px, 72vw)", height: "auto" }}
        />
        <Typography
          component="h1"
          sx={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "baseline",
            gap: 2,
            m: 0,
            fontSize: fontSize.h2,
            fontWeight: fontWeight.medium,
            letterSpacing: "0.16em",
            color: color.brandTaupe,
          }}
        >
          <Box component="span" sx={{ fontWeight: fontWeight.bold, letterSpacing: "0.08em" }}>
            404
          </Box>
          <span>不好意思，系統找不到您需要的服務</span>
        </Typography>
      </Box>
    </Box>
  );
}
