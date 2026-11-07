import { authorizationInput } from './authorization-query.dto';
import { AssignmentDto } from './assignment.dto';

describe('授權指派輸入邊界', () => {
  it('員編保留大小寫與空白，ID限安全正整數字串且拒絕未知欄位', () => {
    expect(
      authorizationInput(AssignmentDto, {
        empId: ' Ab01 ',
        roleIds: ['1'],
        expectedRoleIds: [],
      }),
    ).toEqual({ empId: ' Ab01 ', roleIds: ['1'], expectedRoleIds: [] });
    for (const input of [
      { empId: 'a'.repeat(33), roleIds: [], expectedRoleIds: [] },
      { empId: 'a', roleIds: ['9007199254740992'], expectedRoleIds: [] },
      { empId: 'a', roleIds: ['1', '1'], expectedRoleIds: [] },
      { empId: 'a', roleIds: [], expectedRoleIds: [1] },
      { empId: 'a', roleIds: [], expectedRoleIds: [], actor: 'super_user' },
      {
        empId: 'a',
        roleIds: Array.from({ length: 51 }, (_, i) => String(i + 1)),
        expectedRoleIds: [],
      },
    ])
      expect(() => authorizationInput(AssignmentDto, input)).toThrow(
        '授權請求格式不正確',
      );
  });
});
