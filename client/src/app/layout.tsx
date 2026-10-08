import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import theme from "@/theme/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "電子簽署",
  description: "饗賓內部電子簽服務",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // 瀏覽器擴充功能（如沉浸式翻譯）會在 React 載入前替 <html> 加屬性，造成 hydration 警告；
    // suppressHydrationWarning 只忽略 <html> 本身的屬性差異，不影響子元素的檢查
    <html lang="zh-Hant-TW" suppressHydrationWarning>
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
