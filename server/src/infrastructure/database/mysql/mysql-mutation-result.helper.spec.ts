import { getAffectedRowCount } from './mysql-mutation-result.helper';

describe('getAffectedRowCount', () => {
  it('回傳 MySQL mutation result 的 affectedRows', () => {
    expect(getAffectedRowCount({ affectedRows: 3 })).toBe(3);
  });

  it.each([null, undefined, [], {}, { affectedRows: '3' }])(
    '結果格式不符時拋出明確錯誤：%p',
    (result) => {
      expect(() => getAffectedRowCount(result)).toThrow(
        'MySQL mutation result 缺少數字型別的 affectedRows',
      );
    },
  );
});
