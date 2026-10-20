import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RejectionDto } from './rejection.dto';

describe('拒簽輸入契約', () => {
  it('接受 trim 後 200 個 Unicode code points，拒絕 null 與超長原因', async () => {
    const requestId = 'd94d7587-6fb7-4c06-8ebf-79a608ea23e3';
    const valid = plainToInstance(RejectionDto, {
      requestId,
      reason: `  ${'😀'.repeat(200)}  `,
    });
    expect(await validate(valid)).toEqual([]);
    expect(valid.reason).toBe('😀'.repeat(200));
    for (const reason of [null, '😀'.repeat(201)]) {
      expect(
        (await validate(plainToInstance(RejectionDto, { requestId, reason })))
          .length,
      ).toBeGreaterThan(0);
    }
    expect(
      await validate(plainToInstance(RejectionDto, { requestId })),
    ).toEqual([]);
  });
});
