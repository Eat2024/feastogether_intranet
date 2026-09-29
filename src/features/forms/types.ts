export type DocType = "online" | "upload";

/** 簽署狀態；completed 由簽署人全數完成推導而來，不直接存 */
export type FormStatus = "draft" | "active" | "completed" | "stopped";

export type Signer = {
  id: string;
  name: string;
  /** 八碼員工編號 */
  employeeNo: string;
  status: "pending" | "signed" | "rejected";
  signedAt?: string;
  rejectedAt?: string;
  /** 拒絕原因（選填） */
  rejectReason?: string;
  /** 已被提醒的次數 */
  notifyCount?: number;
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
};

/** 上傳文件上的一個欄位位置（x、y 為頁面寬高的百分比） */
export type UploadField = {
  id: number;
  page: number;
  x: number;
  y: number;
  type: "sign" | "date";
};

export type UploadInfo = {
  fileName: string;
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
};
