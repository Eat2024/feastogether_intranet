// 組織架構與在職員工（僅供伺服器端使用）。
// 資料來源：data/org-chart.json（含個人資料，已列入 .gitignore，不可提交）；
// 檔案不存在時改用「測試人員（假資料）」部門，讓沒有資料檔的環境也能執行。
// 串接人事系統 API 時替換 loadOrgChart 即可。
import fs from 'node:fs';
import path from 'node:path';
import { CURRENT_USER_ID, FALLBACK_USER_ID, MOCK_EMPLOYEES } from './mock';
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
// （結構有變動時更換 key，讓開發伺服器熱更新後重建，不沿用舊結構的快取）
const g = globalThis as typeof globalThis & {
  __orgChartV2?: {
    tree: OrgDept[];
    staff: Map<string, StaffMember>;
    /** 員工 id → 所屬部門 id */
    staffDept: Map<string, string>;
    /** 部門 id → 部門 */
    deptIndex: Map<string, OrgDept>;
  };
};

function getCache() {
  if (!g.__orgChartV2) {
    const tree = loadOrgChart();
    const staff = new Map<string, StaffMember>();
    const staffDept = new Map<string, string>();
    const deptIndex = new Map<string, OrgDept>();
    const walk = (dept: OrgDept) => {
      deptIndex.set(dept.id, dept);
      for (const e of dept.employees) {
        staff.set(e.id, { id: e.id, name: e.name, employeeNo: e.employeeNo ?? e.id, dept: dept.name });
        staffDept.set(e.id, dept.id);
      }
      dept.children.forEach(walk);
    };
    tree.forEach(walk);
    g.__orgChartV2 = { tree, staff, staffDept, deptIndex };
  }
  return g.__orgChartV2;
}

/** 部門樹（含各部門人數），供選擇簽署人 */
export function getOrgTree(): OrgDept[] {
  return getCache().tree;
}

/** 依 id 查員工（含所屬部門名稱） */
export function getStaff(id: string): StaffMember | undefined {
  return getCache().staff.get(id);
}

/**
 * 目前登入者的 id（尚未串接登入）。組織架構中找不到時（例如沒有資料檔）改用假資料的李秉彥。
 * 串接登入時改為從 session 取得即可。
 */
export function getCurrentUserId(): string {
  return getStaff(CURRENT_USER_ID) ? CURRENT_USER_ID : FALLBACK_USER_ID;
}

export function getCurrentUser(): StaffMember {
  return getStaff(getCurrentUserId())!;
}

/** 簽署人所屬部門；組織架構查不到時改查假資料名冊，以 Email 加入者為 null */
export function getDeptName(signerId: string): string | null {
  return getStaff(signerId)?.dept ?? MOCK_EMPLOYEES.find((e) => e.id === signerId)?.dept ?? null;
}

/** 員工所屬部門 id；不在組織架構中則為 undefined */
export function getDeptIdOf(staffId: string): string | undefined {
  return getCache().staffDept.get(staffId);
}

/** 部門 id 展開為「自己＋所有下層部門」的 id */
export function expandDeptIds(ids: string[]): Set<string> {
  const { deptIndex } = getCache();
  const out = new Set<string>();
  const walk = (d: OrgDept) => {
    out.add(d.id);
    d.children.forEach(walk);
  };
  for (const id of ids) {
    const d = deptIndex.get(id);
    if (d) walk(d);
    else out.add(id); // 非組織架構的分組（例如假資料部門、Email）原樣保留
  }
  return out;
}
