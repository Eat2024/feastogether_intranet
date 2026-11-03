import type {
  PortalDepartmentRow,
  PortalOrgChartEmployeeRow,
} from '#app/infrastructure/portal/portal.types';
import type { OrgDepartmentDto } from '../dto/org-chart.dto';
import { buildOrgChart } from './org-chart.builder';

// 規則移植自 fgapi app/Services/OrgChartBuilder.php 與 tests/Feature/OrgChartTest.php（只作參考）。
const department = (
  department_ch_id: string,
  department_parent_guid = '',
  department_name = `部門${department_ch_id}`,
): PortalDepartmentRow => ({
  department_ch_id,
  department_name,
  department_parent_guid,
  startdate: '2025-01-01',
  stopdate: null,
});

const employee = (
  person_empid: string,
  department_id: string,
): PortalOrgChartEmployeeRow => ({
  person_empid,
  person_name: `員工${person_empid}`,
  title: '專員',
  department_id,
});

interface Outline {
  id: string;
  employees: string[];
  children: Outline[];
}

/** 只留部門代碼、員編與階層，方便比對結構與順序。 */
const outline = (nodes: OrgDepartmentDto[]): Outline[] =>
  nodes.map((node) => ({
    id: node.department_ch_id,
    employees: node.employees.map((item) => item.person_empid),
    children: outline(node.children),
  }));

describe('buildOrgChart', () => {
  it('根部門的上層代碼空字串轉成 null，員工只留三個欄位，對不到部門的員工不列入並計數', () => {
    expect(
      buildOrgChart(
        [department('001', '', '總部')],
        [employee('0001', '001'), employee('0002', 'unknown')],
      ),
    ).toEqual({
      tree: [
        {
          department_ch_id: '001',
          department_name: '總部',
          department_parent_guid: null,
          startdate: '2025-01-01',
          stopdate: null,
          children: [],
          employees: [
            { person_empid: '0001', person_name: '員工0001', title: '專員' },
          ],
        },
      ],
      unmappedEmployees: 1,
    });
  });

  it('多根節點與深層巢狀依輸入順序組樹；子部門員工不複製到上層，沒有員工的部門保留空陣列', () => {
    const { tree, unmappedEmployees } = buildOrgChart(
      [
        department('100'),
        department('110', '100'),
        department('111', '110'),
        department('200'),
        department('120', '100'),
      ],
      [
        employee('0001', '111'),
        employee('0002', '100'),
        employee('0003', '200'),
        employee('0004', '111'),
        employee('0005', '110'),
      ],
    );
    expect(outline(tree)).toEqual([
      {
        id: '100',
        employees: ['0002'],
        children: [
          {
            id: '110',
            employees: ['0005'],
            children: [
              { id: '111', employees: ['0001', '0004'], children: [] },
            ],
          },
          { id: '120', employees: [], children: [] },
        ],
      },
      { id: '200', employees: ['0003'], children: [] },
    ]);
    expect(tree[0].children[0].department_parent_guid).toBe('100');
    expect(unmappedEmployees).toBe(0);
  });

  it('上層部門不存在或已停用（不在輸入中）時，該部門成為根節點並保留原上層代碼', () => {
    const { tree } = buildOrgChart(
      [department('100'), department('300', '999'), department('310', '300')],
      [],
    );
    expect(outline(tree)).toEqual([
      { id: '100', employees: [], children: [] },
      {
        id: '300',
        employees: [],
        children: [{ id: '310', employees: [], children: [] }],
      },
    ]);
    expect(tree[1].department_parent_guid).toBe('999');
  });

  /** 由根往下 depth 層的單一鏈。 */
  const chain = (depth: number) =>
    Array.from({ length: depth }, (_, i) =>
      department(`D${i}`, i === 0 ? '' : `D${i - 1}`),
    );

  it('深度剛好 100 層可以組樹', () => {
    let node = buildOrgChart(chain(100), []).tree[0];
    let depth = 1;
    while (node.children.length > 0) {
      node = node.children[0];
      depth++;
    }
    expect(depth).toBe(100);
  });

  it.each([
    ['部門代碼為空字串', [department('')]],
    ['部門代碼只有空白', [department(' ')]],
    ['部門代碼重複', [department('100'), department('100', '', '同代碼')]],
    ['上層是自己', [department('100'), department('110', '110')]],
    [
      '上下層形成循環',
      [department('100'), department('110', '120'), department('120', '110')],
    ],
    ['深度超過 100 層', chain(101)],
  ])('%s時整批拋錯', (_case, departments) => {
    expect(() => buildOrgChart(departments, [])).toThrow();
  });

  it('空的輸入回傳空陣列', () => {
    expect(buildOrgChart([], [employee('0001', '100')])).toEqual({
      tree: [],
      unmappedEmployees: 1,
    });
  });
});
