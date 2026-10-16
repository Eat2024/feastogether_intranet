/** online：線上建立（舊資料）；upload：上傳文件；sheet：系統產生的簽到表 */
export type DocType = "online" | "upload" | "sheet";

/** 簽署狀態；completed 由簽署人全數完成推導而來，不直接存 */
/** 文件狀態；completed、expired 由 deriveStatus() 推導，不會寫入 store */
export type FormStatus = "draft" | "active" | "expired" | "completed" | "stopped";

export type Signer = {
  /** 組織架構的同仁為員工編號；以 Email 加入者為 `email:` 前綴＋email */
  id: string;
  name: string;
  /** 員工編號；以 Email 加入者為空字串 */
  employeeNo: string;
  /** 以 Email 加入（未列入組織架構）的簽署人 */
  email?: string;
  status: "pending" | "signed" | "rejected";
  signedAt?: string;
  rejectedAt?: string;
  /** 拒絕原因（選填） */
  rejectReason?: string;
  /** 已被提醒的次數 */
  notifyCount?: number;
  /** 最後一次被提醒的時間（YYYY/MM/DD HH:mm） */
  lastNotifiedAt?: string;
  /** 各簽名欄位的手寫簽名（欄位 id → PNG data URL） */
  signatures?: Record<number, string>;
  /** 各簽名欄位的簽名識別碼（欄位 id → UUID），對應簽名追蹤 QR code */
  signatureIds?: Record<number, string>;
  /** 簽署時同意的電子簽名使用條款 */
  consent?: { version: string; agreedAt: string };
  /** 管理端記錄的備註（最多 30 字，見 signerNote.ts）；屬內部紀錄，不提供給簽署人本人 */
  note?: string;
  /** 加入簽署時的單位（部門）與職稱快照（簽到表顯示用；以 Email 加入者沒有） */
  unit?: string;
  title?: string;
  /** 簽到表：簽署人簽到時自行填寫的備註（見 sheet.ts） */
  remark?: string;
  /** 簽到表：發起後由建立人臨時追加的簽署人（加入時間與加入人，供稽核） */
  lateAdded?: { at: string; by: Employee };
  /** 簽到表：在表上的序號。只有簽署人視角（toSignerView）會帶出，不寫入 store */
  rowNo?: number;
};

export type Employee = {
  name: string;
  /** 八碼員工編號 */
  employeeNo: string;
};

/** 員工名冊中的一位員工（選擇簽署人用） */
export type StaffMember = Employee & {
  id: string;
  dept: string;
  title?: string;
};

/** 組織架構中的一個部門（選擇簽署人用）；total 為含所有子部門的人數 */
export type OrgDept = {
  id: string;
  name: string;
  children: OrgDept[];
  /** employeeNo 省略時與 id 相同（人事資料以員工編號為 id） */
  employees: { id: string; name: string; title: string; employeeNo?: string }[];
  total: number;
};

/** 上傳文件上的一個欄位位置（x、y 為頁面寬高的百分比） */
export type UploadField = {
  id: number;
  page: number;
  x: number;
  y: number;
  /** 欄位寬、高（頁面寬高的百分比）；舊資料沒有時使用預設尺寸（見 signLayout.ts 的 fieldSize） */
  w?: number;
  h?: number;
  type: "sign" | "date";
};

export type UploadInfo = {
  fileName: string;
  /** 伺服器保存的原始檔 id（見 files.ts）；舊資料或示意資料沒有 */
  fileId?: string;
  pages: number;
  /** inline：在原文件上拖曳指定欄位；confirmPage：附加系統簽署確認頁 */
  mode: "inline" | "confirmPage";
  fields: UploadField[];
};

export type EFormDoc = {
  id: string;
  name: string;
  docNumber: string | null;
  docType: DocType;
  status: "draft" | "active" | "stopped";
  startAt: string | null;
  endAt: string | null;
  signers: Signer[];
  createdBy: Employee;
  /** 上傳文件的設定（線上建立的舊資料沒有） */
  upload?: UploadInfo;
  /** 補簽紀錄（依時間先後）；最後一筆的期間為目前的簽署期間 */
  resigns?: ResignRound[];
  /** 可選功能（浮水印、拒絕簽署）；未設定時見 options.ts 的預設值 */
  options?: { watermark: boolean; allowReject: boolean };
  /** 簽到表的設定（docType 為 sheet 時才有） */
  sheet?: SheetInfo;
};

/** 簽到表：表頭可自行設定，表格欄位固定（序號、單位、職稱、姓名、簽到、簽到時間、備註） */
export type SheetInfo = {
  /** 表單標題，例如「教育訓練簽到表」 */
  title: string;
  /** 表單編號，例如 FT-2100-01-007-001（選填） */
  formCode: string;
  /** 表頭欄位（依順序兩欄排列）；「出席人數」由系統自動加上 */
  fields: { label: string; value: string }[];
};

/** 一次補簽：到期後仍有人未簽署時，重新開放未簽署者在新期間內簽署 */
export type ResignRound = {
  /** 補簽期間（YYYY/MM/DD） */
  startAt: string;
  endAt: string;
  /** 設定時間（YYYY/MM/DD HH:mm） */
  createdAt: string;
  /** 補簽原因與設定人：寫入時必填；簽署人視角（toSignerView）會移除 */
  reason?: string;
  createdBy?: Employee;
};
