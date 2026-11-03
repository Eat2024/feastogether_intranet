import type {
  PortalDepartmentRow,
  PortalOrgChartEmployeeRow,
} from '#app/infrastructure/portal/portal.types';
import type { OrgDepartmentDto } from '../dto/org-chart.dto';

const MAX_DEPTH = 100;

export interface OrgChart {
  tree: OrgDepartmentDto[];
  /** 正式員工中，所屬部門不在樹中（不存在或已停用）的人數。 */
  unmappedEmployees: number;
}

/**
 * 依 Portal 未停用部門與正式員工組出選人部門樹，規則照 fgapi OrgChartBuilder（饗賓人 hr/org_chart）。
 * 部門與員工維持輸入順序（排序在 SQL 完成）。部門代碼空白或重複、形成循環、深度超過 100 層時拋錯，整批不可用。
 */
export function buildOrgChart(
  departments: readonly PortalDepartmentRow[],
  employees: readonly PortalOrgChartEmployeeRow[],
): OrgChart {
  const nodes = new Map<string, OrgDepartmentDto>();
  for (const row of departments) {
    if (!row.department_ch_id.trim() || nodes.has(row.department_ch_id)) {
      throw new Error('組織架構有空白或重複的部門代碼');
    }
    nodes.set(row.department_ch_id, {
      department_ch_id: row.department_ch_id,
      department_name: row.department_name,
      department_parent_guid: row.department_parent_guid || null,
      startdate: row.startdate,
      stopdate: row.stopdate,
      children: [],
      employees: [],
    });
  }

  // 依輸入順序掛到上層（SQL 已排序）；上層不存在或已停用時，保留本部門為根節點。
  const tree: OrgDepartmentDto[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.department_parent_guid ?? '');
    (parent ? parent.children : tree).push(node);
  }

  // 每個部門只有一個上層；從根走不到的部門表示上下層形成循環。
  let reachable = 0;
  const visit = (level: OrgDepartmentDto[], depth: number) => {
    if (level.length > 0 && depth > MAX_DEPTH) {
      throw new Error('組織架構超過部門層數上限');
    }
    for (const node of level) {
      reachable++;
      visit(node.children, depth + 1);
    }
  };
  visit(tree, 1);
  if (reachable !== nodes.size) {
    throw new Error('組織架構的部門上下層形成循環');
  }

  let unmappedEmployees = 0;
  for (const row of employees) {
    const node = nodes.get(row.department_id);
    if (!node) {
      unmappedEmployees++;
      continue;
    }
    node.employees.push({
      person_empid: row.person_empid,
      person_name: row.person_name,
      title: row.title,
    });
  }

  return { tree, unmappedEmployees };
}
