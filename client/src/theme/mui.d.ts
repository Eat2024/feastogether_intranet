// MUI 型別擴充：讓 theme 新增的 palette 欄位、文字樣式組合與 Chip variant 可被型別檢查
import "@mui/material/styles";
import "@mui/material/Chip";
import "@mui/material/Typography";
import type { TypographyStyle } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface PaletteColor {
    /** 淡底（soft chip 底色） */
    less?: string;
  }
  interface SimplePaletteColorOptions {
    less?: string;
  }
  interface TypeText {
    headline: string;
    placeholder: string;
  }
  interface Palette {
    navBg: string;
    formBorder: string;
  }
  interface PaletteOptions {
    navBg?: string;
    formBorder?: string;
  }

  // 文字樣式組合（封閉清單 10 組），定義見 theme.ts
  interface TypographyVariants {
    pageTitle: TypographyStyle;
    sectionTitle: TypographyStyle;
    subheading: TypographyStyle;
    body: TypographyStyle;
    description: TypographyStyle;
    content: TypographyStyle;
    secondary: TypographyStyle;
    label: TypographyStyle;
    helper: TypographyStyle;
    kpi: TypographyStyle;
  }
  interface TypographyVariantsOptions {
    pageTitle?: TypographyStyle;
    sectionTitle?: TypographyStyle;
    subheading?: TypographyStyle;
    body?: TypographyStyle;
    description?: TypographyStyle;
    content?: TypographyStyle;
    secondary?: TypographyStyle;
    label?: TypographyStyle;
    helper?: TypographyStyle;
    kpi?: TypographyStyle;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    pageTitle: true;
    sectionTitle: true;
    subheading: true;
    body: true;
    description: true;
    content: true;
    secondary: true;
    label: true;
    helper: true;
    kpi: true;
  }
}

declare module "@mui/material/Chip" {
  interface ChipPropsVariantOverrides {
    soft: true;
  }
}
