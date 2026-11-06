// 旅遊平台的頁面路徑與名稱（比照 CKS_Acceptance_System 的 constants/routes.ts）；
// 選單、頁面標題都從這裡取，改名或改路徑只動這一處。
export const TRAVEL_ROUTES = {
  home: {
    href: "/travel",
    label: "首頁",
  },
  permissionManagement: {
    href: "/travel/permissionManagement",
    label: "權限管理",
  },
  roleManagement: {
    href: "/travel/permissionManagement/roleManagement",
    label: "角色管理",
  },
  accountManagement: {
    href: "/travel/permissionManagement/accountManagement",
    label: "帳號管理",
  },
  operationLogs: {
    href: "/travel/permissionManagement/operationLogs",
    label: "操作紀錄",
  },
  myTravel: {
    href: "/travel/myTravel",
    label: "我的行程",
  },
  tripRegistration: {
    href: "/travel/myTravel/tripRegistration",
    label: "我要報名",
  },
  myItineraries: {
    href: "/travel/myTravel/myItineraries",
    label: "我的行程",
  },
  personalAndDependentInfo: {
    href: "/travel/myTravel/personalAndDependentInfo",
    label: "個人與眷屬資料",
  },
  votingManagement: {
    href: "/travel/votingManagement",
    label: "投票設定",
  },
  votingEventSettings: {
    href: "/travel/votingManagement/votingEventSettings",
    label: "投票活動設定（含名單匯入＆候選行程）",
  },
  tripVoting: {
    href: "/travel/votingManagement/tripVoting",
    label: "投票頁",
  },
  registrationManagement: {
    href: "/travel/registrationManagement",
    label: "報名管理",
  },
  registrationSettings: {
    href: "/travel/registrationManagement/registrationSettings",
    label: "報名設定（含參團限制設定）",
  },
  tripSessionManagement: {
    href: "/travel/registrationManagement/tripSessionManagement",
    label: "報名行程與梯次管理",
  },
  departureLocationManagement: {
    href: "/travel/registrationManagement/departureLocationManagement",
    label: "集合／出發地點維護",
  },
  formDownloads: {
    href: "/travel/registrationManagement/formDownloads",
    label: "表單下載區",
  },
  registrationOrderQuery: {
    href: "/travel/registrationManagement/registrationOrderQuery",
    label: "報名訂單查詢",
  },
  batchDownloadHistory: {
    href: "/travel/registrationManagement/batchDownloadHistory",
    label: "報名文件批次下載記錄",
  },
  contentManagement: {
    href: "/travel/contentManagement",
    label: "公告管理",
  },
  noticeAndConsentManagement: {
    href: "/travel/contentManagement/noticeAndConsentManagement",
    label: "注意事項與同意條款維護",
  },
  standardContractManagement: {
    href: "/travel/contentManagement/standardContractManagement",
    label: "定型化契約維護",
  },
  downloadFormManagement: {
    href: "/travel/contentManagement/downloadFormManagement",
    label: "表單下載區維護",
  },
  registerFormManagement: {
    href: "/travel/contentManagement/registerFormManagement",
    label: "報名資料填報名辦法維護",
  },
  emailManagement: {
    href: "/travel/contentManagement/emailManagement",
    label: "通知信範本維護、寄與確認",
  },
} as const;

/**
 * 路徑與名稱的對照表，給麵包屑依網址逐層找名稱用。
 */
export const TRAVEL_ROUTE_LABEL_MAP = Object.values(TRAVEL_ROUTES).reduce<Record<string, string>>(
  (acc, route) => {
    acc[route.href] = route.label;
    return acc;
  },
  {},
);
