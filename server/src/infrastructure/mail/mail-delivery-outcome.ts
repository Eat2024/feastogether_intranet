/** 僅識別明確未接受的 SMTP 失敗，不把 DATA 後斷線誤判成可安全重送。 */
export function isDefinitelyUnsent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (
    'responseCode' in error &&
    typeof error.responseCode === 'number' &&
    error.responseCode >= 400 &&
    error.responseCode < 600
  )
    return true;
  return (
    'code' in error &&
    ['EAUTH', 'EDNS', 'ECONNECTION'].includes(String(error.code))
  );
}
