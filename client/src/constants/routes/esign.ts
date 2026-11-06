// 電子簽的頁面路徑與名稱（比照 CKS_Acceptance_System 的 constants/routes.ts）。
// 帶文件 id 的頁面由這裡的路徑組出，例如 `${ESIGN_ROUTES.forms.href}/${id}/edit`。
// proxy 的 matcher、next.config 的舊網址轉址與 PageProps 型別必須是字面值，不從這裡取。
export const ESIGN_ROUTES = {
  home: {
    href: "/esign",
    label: "電子簽署",
  },
  forms: {
    href: "/esign/forms",
    label: "電子簽列表",
  },
  createForm: {
    href: "/esign/forms/new",
    label: "新增電子簽文件",
  },
  mySignature: {
    href: "/esign/my-signature",
    label: "我的電子簽",
  },
  exportHistory: {
    href: "/esign/export-history",
    label: "歷史匯出文件",
  },
} as const;
