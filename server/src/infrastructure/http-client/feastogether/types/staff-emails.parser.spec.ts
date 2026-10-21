import { parseStaffEmails } from './staff-emails.parser';

describe('員工信箱來源解析', () => {
  it.each([
    null,
    {},
    [null],
    [{ person_empid: 1, email: 'x@example.test' }],
    [{ person_empid: '001', email: null }],
    [{ person_empid: '999', email: 'x@example.test' }],
    [
      { person_empid: '001', email: 'x@example.test' },
      { person_empid: '001', email: 'x@example.test' },
    ],
  ])('拒絕結構錯誤、重複及請求外員編 %#', (payload) => {
    expect(() => parseStaffEmails(payload, ['001'])).toThrow(
      '員工信箱來源暫時無法使用',
    );
  });
  it('空結果合法，非法地址只標記不可用', () => {
    expect(parseStaffEmails([], ['001'])).toEqual(new Map());
    expect(
      parseStaffEmails(
        [{ person_empid: '001', email: 'not-an-email' }],
        ['001'],
      ),
    ).toEqual(new Map([['001', null]]));
  });
  it('以完整員編對應亂序及稀疏結果，保留前導零並正規化有效地址', () => {
    expect(
      parseStaffEmails(
        [
          { person_empid: '002', email: ' Shared@Example.test ' },
          { person_empid: '001', email: 'shared@example.test' },
          { person_empid: '003', email: ' ' },
        ],
        ['001', '002', '003', '004'],
      ),
    ).toEqual(
      new Map([
        ['002', 'shared@example.test'],
        ['001', 'shared@example.test'],
        ['003', null],
      ]),
    );
  });
});
