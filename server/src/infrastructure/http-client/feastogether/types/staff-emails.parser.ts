import { isEmail } from 'class-validator';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';

/** 僅接受請求中的完整員編；稀疏與無有效地址不代表已知人事狀態。 */
export function parseStaffEmails(
  payload: unknown,
  requested: readonly string[],
): Map<string, string | null> {
  const invalid = () =>
    new AppException(...AppErrors.ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE);
  if (!Array.isArray(payload)) throw invalid();
  const allowed = new Set(requested);
  const result = new Map<string, string | null>();
  for (const row of payload as unknown[]) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid();
    const item = row as Record<string, unknown>;
    if (
      typeof item.person_empid !== 'string' ||
      typeof item.email !== 'string' ||
      !allowed.has(item.person_empid) ||
      result.has(item.person_empid)
    )
      throw invalid();
    const email = item.email.trim().toLowerCase();
    result.set(
      item.person_empid,
      email.length <= 255 && isEmail(email) ? email : null,
    );
  }
  return result;
}
