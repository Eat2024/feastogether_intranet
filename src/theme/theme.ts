"use client";

/* ==========================================================================
   theme.ts — 全專案唯一的 MUI theme
   1. 所有值由 ./tokens 餵入，本檔不寫死色碼／字面值。
   2. MUI 預設值與設計系統衝突時以設計系統為準，差異寫在 components 覆寫，
      不逐頁用 sx 修。
   ========================================================================== */

import { createTheme, type TypographyStyle } from "@mui/material/styles";
import { dialogClasses } from "@mui/material/Dialog";
import {
  breakpoints,
  color,
  cssVariables,
  dialog,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacingUnit,
} from "./tokens";

const rem = (px: number) => `${px / 16}rem`;

function type(size: number, weight: number, lh: number, textColor?: string): TypographyStyle {
  return { fontSize: rem(size), fontWeight: weight, lineHeight: lh, ...(textColor && { color: textColor }) };
}

// 非 fullScreen 時才套用固定寬度，fullScreen 維持滿版、無圓角
const floating = `&:not(.${dialogClasses.paperFullScreen})`;
const dialogWidth = (width: number) => ({
  [floating]: { maxWidth: `min(${width}px, calc(100% - ${dialog.margin * 2}px))` },
});

const SOFT_COLORS = ["primary", "success", "warning", "error", "info"] as const;

const theme = createTheme({
  cssVariables: true,
  breakpoints: { values: breakpoints },
  spacing: spacingUnit,
  shape: { borderRadius: radius.base },

  palette: {
    mode: "light",
    primary: {
      main: color.primary,
      dark: color.primaryDark,
      light: color.primaryLight,
      contrastText: color.primaryContrast,
      less: color.primarySurface,
    },
    grey: color.gray,
    success: {
      main: color.success,
      dark: color.successDarken,
      light: color.successLighten,
      less: color.successLess,
    },
    warning: { main: color.warning, dark: color.warningDarken, less: color.warningLess },
    error: { main: color.error, dark: color.errorDarken, less: color.errorLess },
    info: { main: color.info, dark: color.infoDarken, less: color.infoLess },
    text: {
      primary: color.textDefault,
      secondary: color.textSubtitle,
      disabled: color.textPlaceholder,
      headline: color.textHeadline,
      placeholder: color.textPlaceholder,
    },
    background: { default: color.bgLight, paper: color.bgWhite },
    divider: color.divider,
    action: {
      hover: color.actionHover,
      selected: color.actionSelected,
      disabled: color.actionDisabled,
      disabledBackground: color.actionDisabledBg,
    },
    navBg: color.navBg,
    formBorder: color.formBorder,
  },

  typography: {
    // next/font 變數由 app/layout.tsx 掛在 <html>
    fontFamily: "var(--font-noto-sans-tc), var(--font-roboto), system-ui, sans-serif",
    fontSize: fontSize.body2,
    htmlFontSize: 16,
    fontWeightLight: fontWeight.normal,
    fontWeightRegular: fontWeight.normal,
    fontWeightMedium: fontWeight.medium,
    fontWeightBold: fontWeight.bold,

    // MUI 內建 variant 對齊六階字級（h2＝24、h3＝20；MUI h5／h6 同為 24／20）
    h1: type(fontSize.h1, fontWeight.bold, lineHeight.tight),
    h2: type(fontSize.h2, fontWeight.bold, lineHeight.tight),
    h3: type(fontSize.h3, fontWeight.bold, lineHeight.tight),
    h4: type(fontSize.h3, fontWeight.medium, lineHeight.tight),
    h5: type(fontSize.h2, fontWeight.bold, lineHeight.tight),
    h6: type(fontSize.h3, fontWeight.bold, lineHeight.tight),
    subtitle1: type(fontSize.body, fontWeight.medium, lineHeight.body),
    subtitle2: type(fontSize.body2, fontWeight.medium, lineHeight.body),
    body1: type(fontSize.body, fontWeight.normal, lineHeight.body),
    body2: type(fontSize.body2, fontWeight.normal, lineHeight.body),
    button: { ...type(fontSize.body2, fontWeight.medium, lineHeight.tight), textTransform: "none" },
    caption: type(fontSize.caption, fontWeight.normal, lineHeight.body),
    overline: {
      ...type(fontSize.caption, fontWeight.medium, lineHeight.body),
      textTransform: "none",
      letterSpacing: 0,
    },

    // 文字樣式組合（封閉清單 10 組）：畫面只用 variant 選組，不另疊 fontSize／fontWeight／color
    pageTitle: type(fontSize.h1, fontWeight.bold, lineHeight.tight, color.textHeadline),
    sectionTitle: type(fontSize.h3, fontWeight.bold, lineHeight.tight, color.textHeadline),
    subheading: type(fontSize.body, fontWeight.medium, lineHeight.tight, color.textDefault),
    body: type(fontSize.body, fontWeight.normal, lineHeight.body, color.textDefault),
    description: type(fontSize.body, fontWeight.normal, lineHeight.body, color.textSubtitle),
    content: type(fontSize.body2, fontWeight.normal, lineHeight.body, color.textDefault),
    secondary: type(fontSize.body2, fontWeight.normal, lineHeight.body, color.textSubtitle),
    label: type(fontSize.body2, fontWeight.medium, lineHeight.body, color.textSubtitle),
    helper: type(fontSize.caption, fontWeight.normal, lineHeight.body, color.textSubtitle),
    kpi: type(fontSize.h1, fontWeight.bold, lineHeight.tight, color.textDefault),
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ":root": cssVariables,
        body: { backgroundColor: color.bgLight, color: color.textDefault },
        a: { color: color.textLink },
      },
    },

    MuiTypography: {
      defaultProps: {
        variantMapping: {
          pageTitle: "h1",
          sectionTitle: "h2",
          subheading: "h3",
          body: "span",
          description: "p",
          content: "p",
          secondary: "p",
          label: "span",
          helper: "span",
          kpi: "span",
        },
      },
    },

    MuiLink: {
      defaultProps: { underline: "hover" },
      styleOverrides: {
        root: { color: color.textLink, "&:hover": { color: color.infoDarken } },
      },
    },

    MuiButton: {
      styleOverrides: {
        // hover 變深（primary.dark），text／outlined hover 用 primary-hover-bg
        root: {
          variants: [
            {
              props: { variant: "contained", color: "primary" },
              style: { "&:hover": { backgroundColor: color.primaryDark } },
            },
            {
              props: { variant: "outlined", color: "primary" },
              style: { "&:hover": { backgroundColor: color.primaryHoverBg } },
            },
            {
              props: { variant: "text", color: "primary" },
              style: { "&:hover": { backgroundColor: color.primaryHoverBg } },
            },
          ],
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: radius.pill,
          fontSize: rem(fontSize.caption),
          fontWeight: fontWeight.medium,
          variants: [
            // soft chip：less 底＋darken 字
            {
              props: { variant: "soft" },
              style: { backgroundColor: color.gray[200], color: color.gray[800] },
            },
            ...SOFT_COLORS.map((c) => ({
              props: { variant: "soft" as const, color: c },
              style: { backgroundColor: theme.palette[c].less, color: theme.palette[c].dark },
            })),
          ],
        }),
        outlined: { borderColor: color.formBorder },
      },
    },

    MuiPaper: {
      styleOverrides: { outlined: { borderColor: color.formBorder } },
    },
    MuiCard: {
      styleOverrides: { root: { borderRadius: radius.card } },
    },

    MuiTableContainer: {
      styleOverrides: { root: { borderRadius: radius.card } },
    },
    // 表格：垂直＋水平格線；外框由 TableContainer（Paper outlined）提供，
    // 最右欄與最後一列不再畫線，避免與外框重疊
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${color.formBorder}`,
          borderRight: `1px solid ${color.formBorder}`,
          "&:last-of-type": { borderRight: 0 },
        },
        head: {
          height: 56,
          paddingTop: 0,
          paddingBottom: 0,
          whiteSpace: "nowrap",
          backgroundColor: color.formBorder,
          color: color.textHeadline,
          fontWeight: fontWeight.medium,
          // 表頭底色即 form-border，格線改用 divider 才看得見
          borderRightColor: color.divider,
          borderBottomColor: color.divider,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&.MuiTableRow-hover:hover": { backgroundColor: color.actionHover },
          "&.Mui-selected": { backgroundColor: color.primarySurface },
          "&:last-of-type > .MuiTableCell-body": { borderBottom: 0 },
        },
      },
    },

    // Dialog：寬度一律用 maxWidth＋fullWidth；≤768 由頁面以
    // useMediaQuery(theme.breakpoints.down("sm")) 切 fullScreen
    MuiDialog: {
      styleOverrides: {
        paperWidthXs: dialogWidth(dialog.widthXs),
        paperWidthSm: dialogWidth(dialog.widthSm),
        paperWidthMd: dialogWidth(dialog.widthMd),
        paperWidthLg: {
          [floating]: {
            maxWidth: `min(${dialog.widthLg}px, calc(100% - ${dialog.margin * 2}px))`,
            borderRadius: radius.dialogLg,
            boxShadow: dialog.shadowLg,
          },
        },
        paperFullScreen: { borderRadius: 0 },
      },
    },
    MuiDialogContent: {
      styleOverrides: { root: { padding: `${spacingUnit * 2}px ${spacingUnit * 3}px` } },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: { backgroundColor: color.scrim },
        invisible: { backgroundColor: "transparent" }, // Menu／Popover 的透明遮罩不上色
      },
    },

    // 進度條：軌道與進度皆為膠囊形（左右圓角）
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 6, borderRadius: radius.pill },
        bar: { borderRadius: radius.pill },
      },
    },
  },
});

export default theme;
