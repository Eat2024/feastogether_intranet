import { EntityManager } from 'typeorm';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { User } from '#app/features/users/entities/user.entity';
import { EsignEmployeeEmailService } from './esign-employee-email.service';

function fixture() {
  const manager = {} as EntityManager;
  const rows = [1, 2, 9].map((id) =>
    Object.assign(new User(), {
      id,
      empid: `00${id}`,
      name: '合成員工',
      isActive: true,
      deletedAt: null,
      email: ' Shared@Example.test ',
    }),
  );
  const findByIdsWithEmail = jest.fn(() => Promise.resolve(rows));
  const service = new EsignEmployeeEmailService({
    findByIdsWithEmail,
  } as unknown as UserRepository);
  return { service, manager, rows, findByIdsWithEmail };
}

describe('本機發起簽署員工資料', () => {
  it('鎖定去重排序的發起者與員工，完整身分與正規化信箱由同一讀取取得', async () => {
    const { service, manager, findByIdsWithEmail } = fixture();
    const result = await service.resolveForInitiation(
      ['2', '1', '2'],
      9,
      manager,
    );
    expect(findByIdsWithEmail).toHaveBeenCalledWith(
      [1, 2, 9],
      manager,
      'shared',
    );
    expect([...result.keys()]).toEqual([1, 2, 9]);
    expect(result.get(1)).toMatchObject({
      empid: '001',
      name: '合成員工',
      email: 'shared@example.test',
    });
  });

  it('純外部名單仍鎖定並驗證發起者', async () => {
    const { service, manager, findByIdsWithEmail, rows } = fixture();
    // 發起者未列為內部簽署人時，不新增員編格式限制。
    rows[2].empid = 'DEV-CREATOR';
    findByIdsWithEmail.mockResolvedValue([rows[2]]);
    expect((await service.resolveForInitiation([], 9, manager)).size).toBe(1);
    expect(findByIdsWithEmail).toHaveBeenCalledWith([9], manager, 'shared');
  });

  it.each([1, 100, 101, 6000, 6001])(
    '接受 %i 位員工；批次與鎖順序交由 repository 控制',
    async (count) => {
      const { service, manager, findByIdsWithEmail } = fixture();
      const rows = Array.from({ length: count }, (_, i) =>
        Object.assign(new User(), {
          id: i + 1,
          empid: `E${i + 1}`,
          name: '合成員工',
          isActive: true,
          email: null,
        }),
      );
      findByIdsWithEmail.mockResolvedValue(rows);
      expect(
        (
          await service.resolveForInitiation(
            rows.map((u) => String(u.id)),
            1,
            manager,
          )
        ).size,
      ).toBe(count);
      expect(findByIdsWithEmail).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { isActive: false },
    { deletedAt: new Date() },
    { empid: 'invalid-id' },
  ])('停用、刪除或員編不合法拒絕發起 %#', async (changed) => {
    const { service, manager, rows } = fixture();
    Object.assign(rows[0], changed);
    await expect(
      service.resolveForInitiation(['1'], 9, manager),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('缺少簽署人或發起者不能當作缺信箱', async () => {
    const { service, manager } = fixture();
    await expect(
      service.resolveForInitiation(['3'], 9, manager),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.resolveForInitiation(['1'], 8, manager),
    ).rejects.toMatchObject({ status: 422 });
  });

  it.each([['01'], ['9007199254740992']])(
    '格式錯誤不查DB %#',
    async (...ids) => {
      const { service, manager, findByIdsWithEmail } = fixture();
      await expect(
        service.resolveForInitiation(ids, 9, manager),
      ).rejects.toMatchObject({ status: 422 });
      expect(findByIdsWithEmail).not.toHaveBeenCalled();
    },
  );

  it('空白、NULL、非法地址不取消員工資格，同信箱也不合併員工', async () => {
    const { service, manager, rows } = fixture();
    rows[0].email = null;
    rows[1].email = 'bad-email';
    rows[2].email = '  ';
    const result = await service.resolveForInitiation(['1', '2'], 9, manager);
    expect([...result.values()].map((u) => u.email)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('DB故障回來源失敗，不退回null信箱集合', async () => {
    const { service, manager, findByIdsWithEmail } = fixture();
    findByIdsWithEmail.mockRejectedValue(new Error('合成DB故障'));
    await expect(
      service.resolveForInitiation(['1'], 9, manager),
    ).rejects.toMatchObject({
      status: 502,
      code: 'ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE',
    });
  });
});
