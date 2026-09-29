import type { Metadata } from "next";
import { Noto_Sans_TC, Roboto } from "next/font/google";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import theme from "@/theme/theme";
import "./globals.css";

const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-sans-tc",
  weight: ["400", "500", "700"],
  display: "swap",
  preload: false,
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "電子簽署",
  description: "饗賓內部電子簽服務",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant-TW" className={`${notoSansTC.variable} ${roboto.variable}`}>
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
