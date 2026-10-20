import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import theme from "@/theme/theme";
import EmbedBridge from "@/features/embed/EmbedBridge";
import ReactQueryProvider from "@/components/providers/ReactQueryProvider";
import SnackbarProvider from "@/components/providers/SnackbarProvider";
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
      <head>
        {/* 被入口網 iframe 嵌入時，在畫面繪製前標記 <html data-embedded>，由 globals.css 隱藏側邊欄；
            新分頁開啟時不標記，保留側邊欄。<html> 的 suppressHydrationWarning 涵蓋此屬性差異 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(window.self!==window.top)document.documentElement.dataset.embedded='true'",
          }}
        />
      </head>
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            {/* 被入口網 iframe 嵌入時，處理入口網以 postMessage 送來的換頁指令 */}
            <EmbedBridge />
            {/* 呼叫後端 API（src/api）用：TanStack Query 與全站錯誤提示 */}
            <SnackbarProvider>
              <ReactQueryProvider>{children}</ReactQueryProvider>
            </SnackbarProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
