export type DocType = "online" | "upload";

/** 簽署狀態；completed 由簽署人全數完成推導而來，不直接存 */
export type FormStatus = "draft" | "active" | "completed" | "stopped";

export type Signer = {
  id: string;
  name: string;
  status: "pending" | "signed";
  signedAt?: string;
};

export type Employee = {
  name: string;
  /** 八碼員工編號 */
  employeeNo: string;
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
};
