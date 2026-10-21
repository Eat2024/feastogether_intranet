/** 舊電子簽測試的 HR 系統邊界替身；只使用合成員編，不連正式來源。 */
export function syntheticStaffEmails(empids: readonly string[]) {
  return Promise.resolve(
    new Map(
      empids.map((empid) => [empid, `${empid.toLowerCase()}@example.test`]),
    ),
  );
}
