// 組織架構原始資料轉成畫面用的部門樹（純函式，伺服器端讀檔與瀏覽器端呼叫後端 API 共用）。
// 原始格式與饗賓人 API、後端 GET /api/esign/signer-candidates/org-chart 相同。
import type { EsignOrgDepartment } from '@/api/types';
import type { OrgDept } from './types';

/** 本機資料檔的停用日可能有值；後端只回傳未停用的部門 */
export type RawOrgDept = Omit<EsignOrgDepartment, 'stopdate' | 'children' | 'department_parent_guid' | 'startdate'> & {
  stopdate: string | null;
  children: RawOrgDept[];
};

/** 轉換為畫面用的部門樹：略過已停用的部門，以及底下完全沒有員工的部門 */
function toOrgDept(raw: RawOrgDept, today: string): OrgDept | null {
  if (raw.stopdate && raw.stopdate <= today) return null;
  const children = raw.children.map((c) => toOrgDept(c, today)).filter((c): c is OrgDept => c !== null);
  // 姓名缺漏時以員編顯示，職稱缺漏時留白
  const employees = raw.employees.map((e) => ({
    id: e.person_empid,
    name: e.person_name ?? e.person_empid,
    title: e.title ?? '',
  }));
  const total = employees.length + children.reduce((sum, c) => sum + c.total, 0);
  if (total === 0) return null;
  return { id: raw.department_ch_id, name: raw.department_name, children, employees, total };
}

/** today 為 YYYY-MM-DD，停用日在今天以前（含）的部門不列出 */
export function toOrgTree(raw: RawOrgDept[], today: string = new Date().toISOString().slice(0, 10)): OrgDept[] {
  return raw.map((d) => toOrgDept(d, today)).filter((d): d is OrgDept => d !== null);
}
