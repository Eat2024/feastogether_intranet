import { isDefinitelyUnsent } from './mail-delivery-outcome';
it('只重試明確未接受的 SMTP 回覆；連線中斷與未知例外不得盲目重寄', () => {
  expect(isDefinitelyUnsent({ responseCode: 450 })).toBe(true);
  expect(isDefinitelyUnsent({ code: 'EAUTH' })).toBe(true);
  expect(isDefinitelyUnsent({ code: 'ETIMEDOUT', command: 'DATA' })).toBe(
    false,
  );
  expect(isDefinitelyUnsent(new Error('unknown'))).toBe(false);
  expect(isDefinitelyUnsent({ responseCode: 250 })).toBe(false);
});
