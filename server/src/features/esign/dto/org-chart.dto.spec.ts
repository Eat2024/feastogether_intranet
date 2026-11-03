import { parseOrgChart } from './org-chart.dto';

const department = () => ({
  department_ch_id: '001',
  department_name: '合成部門',
  department_parent_guid: null,
  startdate: '',
  stopdate: null,
  children: [],
  employees: [
    { person_empid: '00000001', person_name: null, title: null, extra: '移除' },
  ],
  extra: '移除',
});

describe('組織樹契約', () => {
  it('保留多根、十層、來源順序、空陣列與前導零，裁切額外欄位', () => {
    let root: object = department();
    for (let i = 0; i < 9; i++) root = { ...department(), children: [root] };
    const result = parseOrgChart([
      root,
      { ...department(), department_ch_id: '002', employees: [] },
    ]);
    expect(result.map((node) => node.department_ch_id)).toEqual(['001', '002']);
    expect(JSON.stringify(result)).not.toContain('移除');
    let node = result[0];
    for (let i = 0; i < 9; i++) {
      expect(node.employees).toHaveLength(1);
      node = node.children[0];
    }
    expect(node.employees).toEqual([
      { person_empid: '00000001', person_name: null, title: null },
    ]);
    expect(node.children).toEqual([]);
    expect(parseOrgChart([])).toEqual([]);
  });
  it.each([
    null,
    {},
    [{ ...department(), children: null }],
    [{ ...department(), stopdate: '' }],
    [{ ...department(), department_ch_id: '' }],
    [
      {
        ...department(),
        employees: [{ person_empid: 1, person_name: null, title: null }],
      },
    ],
    [{ ...department(), startdate: undefined }],
    [
      department(),
      {
        ...department(),
        employees: [{ person_empid: '0001', person_name: null }],
      },
    ],
  ])('拒絕不完整或錯誤格式，不能略過錯誤資料 %#', (value) => {
    expect(() => parseOrgChart(value)).toThrow();
  });
  it('保留非八碼員編、日期原字串及 nullable 欄位', () => {
    expect(
      parseOrgChart([
        {
          ...department(),
          startdate: '來源字串',
          employees: [
            { person_empid: '001', person_name: '合成人員', title: '合成職稱' },
          ],
        },
      ])[0],
    ).toMatchObject({
      startdate: '來源字串',
      employees: [{ person_empid: '001' }],
    });
  });
});
