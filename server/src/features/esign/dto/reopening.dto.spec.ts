import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReopenDocumentDto } from './reopening.dto';

describe('補簽輸入', () => {
  const input = {
    expectedSignEndAt: '2026-10-19T00:00:00.000Z',
    signEndAt: '2026-10-26T08:00:00+08:00',
    reason: ' 補簽 ',
  };
  it('接受明確時區與 500 個 Unicode 字元，原因去除首尾空白', async () => {
    const dto = plainToInstance(ReopenDocumentDto, {
      ...input,
      reason: ` ${'🙂'.repeat(500)} `,
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.reason).toBe('🙂'.repeat(500));
  });
  it.each([
    '2026-10-19',
    '2026-10-19T00:00:00',
    '2026-02-30T00:00:00Z',
    '2026-10-19T00:00:00.0001Z',
  ])('拒絕無時區、錯誤日期與超出毫秒精度：%s', async (value) => {
    expect(
      await validate(
        plainToInstance(ReopenDocumentDto, { ...input, signEndAt: value }),
      ),
    ).not.toHaveLength(0);
  });
  it.each([' ', '🙂'.repeat(501), null, 123])(
    '拒絕不合法原因',
    async (reason) => {
      expect(
        await validate(
          plainToInstance(ReopenDocumentDto, { ...input, reason }),
        ),
      ).not.toHaveLength(0);
    },
  );
});
