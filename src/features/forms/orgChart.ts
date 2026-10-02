// 組織架構與在職員工（僅供伺服器端使用）。
// 資料來源：data/org-chart.json（含個人資料，已列入 .gitignore，不可提交）；
// 檔案不存在時改用「測試人員（假資料）」部門，讓沒有資料檔的環境也能執行。
// 串接人事系統 API 時替換 loadOrgChart 即可。
import fs from 'node:fs';
import path from 'node:path';
import { MOCK_EMPLOYEES } from './mock';
import type { OrgDept, StaffMember } from './types';

const ORG_CHART_PATH = path.join(process.cwd(), 'data', 'org-chart.json');

type RawEmployee = { person_empid: string; person_name: string; title: string };
type RawDept = {
  department_ch_id: string;
  department_name: string;
  stopdate: string | null;
  children: RawDept[];
  employees: RawEmployee[];
};

/** 轉換為畫面用的部門樹：略過已停用的部門，以及底下完全沒有員工的部門 */
function toOrgDept(raw: RawDept, today: string): OrgDept | null {
  if (raw.stopdate && raw.stopdate <= today) return null;
  const children = raw.children.map((c) => toOrgDept(c, today)).filter((c): c is OrgDept => c !== null);
  const employees = raw.employees.map((e) => ({ id: e.person_empid, name: e.person_name, title: e.title }));
  const total = employees.length + children.reduce((sum, c) => sum + c.total, 0);
  if (total === 0) return null;
  return { id: raw.department_ch_id, name: raw.department_name, children, employees, total };
}

// 僅在沒有組織架構檔時使用
const TEST_DEPT: OrgDept = {
  id: 'test',
  name: '測試人員（假資料）',
  children: [],
  employees: MOCK_EMPLOYEES.map((e) => ({ id: e.id, name: e.name, title: e.dept, employeeNo: e.employeeNo })),
  total: MOCK_EMPLOYEES.length,
};

function loadOrgChart(): OrgDept[] {
  if (!fs.existsSync(ORG_CHART_PATH)) return [TEST_DEPT];
  const raw = JSON.parse(fs.readFileSync(ORG_CHART_PATH, 'utf-8')) as RawDept[];
  const today = new Date().toISOString().slice(0, 10);
  return raw.map((d) => toOrgDept(d, today)).filter((d): d is OrgDept => d !== null);
}

// 快取在 globalThis：只在伺服器啟動後第一次使用時讀檔
const g = globalThis as typeof globalThis & {
  __orgChart?: { tree: OrgDept[]; staff: Map<string, StaffMember> };
};

function getCache() {
  if (!g.__orgChart) {
    const tree = loadOrgChart();
    const staff = new Map<string, StaffMember>();
    const walk = (dept: OrgDept) => {
      for (const e of dept.employees) {
        staff.set(e.id, { id: e.id, name: e.name, employeeNo: e.employeeNo ?? e.id, dept: dept.name });
      }
      dept.children.forEach(walk);
    };
    tree.forEach(walk);
    g.__orgChart = { tree, staff };
  }
  return g.__orgChart;
}

/** 部門樹（含各部門人數），供選擇簽署人 */
export function getOrgTree(): OrgDept[] {
  return getCache().tree;
}

/** 依 id 查員工（含所屬部門名稱） */
export function getStaff(id: string): StaffMember | undefined {
  return getCache().staff.get(id);
}
