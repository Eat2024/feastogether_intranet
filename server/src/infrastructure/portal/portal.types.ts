// Portal 查詢的資料列型別，欄位名稱與 Portal 資料表相同（見 specs/024-portal-hr-source/contracts/portal-source.md）。

/** 在職的 person_status 與名稱：0 試用、1 正式；不在表中的值都是非在職。查詢 SQL 依合約寫死 IN (0, 1)。 */
export const PORTAL_ACTIVE_STATUS_NAMES: Readonly<Record<number, string>> = {
  0: '試用',
  1: '正式',
};

/** Portal 字串欄位是 NOT NULL DEFAULT ''：trim 後空白視為缺值。 */
export function blankToNull(value: string): string | null {
  return value.trim() || null;
}

/** 組織樹：未停用部門。根部門的 department_parent_guid 是空字串，不是 NULL。 */
export interface PortalDepartmentRow {
  department_ch_id: string;
  department_name: string;
  department_parent_guid: string;
  startdate: string;
  /** 查詢條件為 stopdate IS NULL。 */
  stopdate: null;
}

/** 組織樹：正式員工（person_status = 1）。 */
export interface PortalOrgChartEmployeeRow {
  person_empid: string;
  person_name: string;
  title: string;
  department_id: string;
}

/** 登入：依員編查到的員工，可能是任何狀態。 */
export interface PortalStaffRow {
  person_empid: string;
  person_name: string;
  department_id: string;
  department_name: string;
  title: string;
  person_status: number;
}

/** 匯入：在職員工（person_status 為 0 或 1）。 */
export interface PortalActiveEmployeeRow extends PortalStaffRow {
  email: string;
}

/** 匯入：依員編查到的人員狀態。 */
export interface PortalStatusRow {
  person_empid: string;
  person_status: number;
}

export interface PortalOrgChartSource {
  departments: PortalDepartmentRow[];
  employees: PortalOrgChartEmployeeRow[];
}
