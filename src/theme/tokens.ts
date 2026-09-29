/* ==========================================================================
   tokens.ts — 全專案唯一的 design token 來源
   依據：設計系統《門市央廚管理系統》（Figma → 饗賓內部系統 DS → MUI 預設）。
   規則：
   1. 主色、灰階、字重、字級為封閉清單，要新增任何值先與設計確認。
   2. 畫面不寫死色碼與字面值；元件用 theme（palette／typography／spacing），
      純 CSS 用本檔輸出的 CSS 變數（例如 var(--primary)，見 cssVariables）。
   3. 圓角 8／16／24px 為設計稿局部例外值，只寫在該元件（見 radius）。
   ========================================================================== */

export const color = {
  // 主色（MUI 預設 palette.primary）；按鈕 hover 用 dark（變深，不變亮）
  primary: "#1976D2",
  primaryDark: "#1565C0",
  primaryLight: "#42A5F5",
  primaryContrast: "#FFFFFF",
  primarySurface: "rgba(25,118,210,0.08)", // 選取列、淡底
  primaryHoverBg: "rgba(25,118,210,0.04)", // text／outlined 按鈕 hover

  // 灰階十階（MUI 預設 palette.grey，封閉清單）
  gray: {
    50: "#FAFAFA",
    100: "#F5F5F5",
    200: "#EEEEEE",
    300: "#E0E0E0",
    400: "#BDBDBD",
    500: "#9E9E9E",
    600: "#757575",
    700: "#616161",
    800: "#424242",
    900: "#212121",
  },

  // 狀態色（饗賓 DS）；soft chip＝less 底＋darken 字
  // success 白底對比不足 AA，只作填色／圖示／大字
  success: "#4CAF50",
  successLighten: "#67BB6A",
  successDarken: "#419544",
  successLess: "#E4F3E5",
  warning: "#FF951C",
  warningDarken: "#D97F18",
  warningLess: "#FFEFDD",
  error: "#FF5254",
  errorDarken: "#D94647",
  errorLess: "#FFE5E6",
  info: "#288BC8", // 亦為連結色
  infoDarken: "#2276AA",
  infoLess: "#DFEEF7",

  // 文字色
  textDefault: "#212121", // gray-900：內文、表格內容
  textHeadline: "#424242", // gray-800：標題
  textSubtitle: "#757575", // gray-600：次要說明、欄位 label
  textPlaceholder: "#BDBDBD", // gray-400：placeholder、停用文字
  textLink: "#288BC8", // info
  textWhite: "#FFFFFF", // 深底／實底上的文字

  // 背景、框線、明列例外色（語意 token，不屬灰階）
  bgWhite: "#FFFFFF", // 卡片、dialog
  bgLight: "#F3F5F6", // app 畫布
  navBg: "#202229", // 側邊導覽、深色返回列
  formBorder: "#E7E9EA", // 卡片／表格／tab 框線、表頭底
  divider: "rgba(0,0,0,0.12)",

  // 互動狀態與遮罩（MUI palette.action）
  actionHover: "rgba(0,0,0,0.04)",
  actionSelected: "rgba(0,0,0,0.08)",
  actionDisabled: "rgba(0,0,0,0.26)",
  actionDisabledBg: "rgba(0,0,0,0.12)",
  scrim: "rgba(0,0,0,0.50)", // Dialog 遮罩，全站只此一值
} as const;

// 字重只用三檔（禁用 300／600／800／900）
export const fontWeight = { normal: 400, medium: 500, bold: 700 } as const;

// 字級封閉清單六階（11／13／15／17／18px 禁用；高密度表格最小 12px）
export const fontSize = {
  caption: 12,
  body2: 14, // ★UI 基準：內文、表格、按鈕、欄位
  body: 16,
  h3: 20,
  h2: 24,
  h1: 30,
} as const;

export const lineHeight = { tight: 1.25, body: 1.7 } as const;

// theme.spacing(n) = 8n；2／12px 對應 spacing(0.25)／spacing(1.5)
export const spacingUnit = 8;

export const radius = {
  base: 4, // shape.borderRadius：button、input、select、menu、xs／sm dialog、alert
  card: 8, // 設計稿 radius/200：卡片、表格容器、tab 容器
  dialogConfirm: 16, // 設計稿 dialog/defualt：確認型 dialog、登入卡
  dialogLg: 24, // 大型編輯 dialog
  pill: 9999, // chip、switch、avatar、badge
} as const;

// 斷點：sm 768 為平板直向／fullScreen dialog 切換點
export const breakpoints = { xs: 0, sm: 768, md: 1024, lg: 1180, xl: 1440 } as const;

export const dialog = {
  widthConfirm: 360,
  widthXs: 444,
  widthSm: 600,
  widthMd: 900,
  widthLg: 1200,
  margin: 32,
  marginSm: 16, // ≤768 確認型
  shadowConfirm: "0 0 10px rgba(0,0,0,0.125)",
  shadowLg: "0 16px 24px rgba(0,0,0,0.08)",
} as const;

/** 供純 CSS 使用的 DS 變數（名稱與設計系統文件一致），由 CssBaseline 掛到 :root */
export const cssVariables: Record<string, string> = {
  "--primary": color.primary,
  "--primary-dark": color.primaryDark,
  "--primary-light": color.primaryLight,
  "--primary-surface": color.primarySurface,
  "--primary-hover-bg": color.primaryHoverBg,
  ...Object.fromEntries(Object.entries(color.gray).map(([k, v]) => [`--gray-${k}`, v])),
  "--success": color.success,
  "--success-lighten": color.successLighten,
  "--success-darken": color.successDarken,
  "--success-less": color.successLess,
  "--warning": color.warning,
  "--warning-darken": color.warningDarken,
  "--warning-less": color.warningLess,
  "--error": color.error,
  "--error-darken": color.errorDarken,
  "--error-less": color.errorLess,
  "--info": color.info,
  "--info-darken": color.infoDarken,
  "--info-less": color.infoLess,
  "--text-default": color.textDefault,
  "--text-headline": color.textHeadline,
  "--text-subtitle": color.textSubtitle,
  "--text-placeholder": color.textPlaceholder,
  "--text-link": color.textLink,
  "--text-white": color.textWhite,
  "--bg-white": color.bgWhite,
  "--bg-light": color.bgLight,
  "--nav-bg": color.navBg,
  "--form-border": color.formBorder,
  "--divider": color.divider,
  "--action-hover": color.actionHover,
  "--action-selected": color.actionSelected,
  "--action-disabled": color.actionDisabled,
  "--action-disabled-bg": color.actionDisabledBg,
  "--scrim": color.scrim,
  "--fw-normal": String(fontWeight.normal),
  "--fw-medium": String(fontWeight.medium),
  "--fw-bold": String(fontWeight.bold),
  ...Object.fromEntries(Object.entries(fontSize).map(([k, v]) => [`--fs-${k}`, `${v}px`])),
  "--lh-tight": String(lineHeight.tight),
  "--lh-body": String(lineHeight.body),
  "--sp-025": "2px",
  "--sp-05": "4px",
  "--sp-1": "8px",
  "--sp-15": "12px",
  "--sp-2": "16px",
  "--sp-3": "24px",
  "--sp-4": "32px",
  "--sp-5": "40px",
  "--sp-6": "48px",
  "--r": `${radius.base}px`,
  "--r-pill": `${radius.pill}px`,
  "--dialog-w-confirm": `${dialog.widthConfirm}px`,
  "--dialog-w-xs": `${dialog.widthXs}px`,
  "--dialog-w-sm": `${dialog.widthSm}px`,
  "--dialog-w-md": `${dialog.widthMd}px`,
  "--dialog-w-lg": `${dialog.widthLg}px`,
  "--dialog-margin": `${dialog.margin}px`,
  "--dialog-margin-sm": `${dialog.marginSm}px`,
};
