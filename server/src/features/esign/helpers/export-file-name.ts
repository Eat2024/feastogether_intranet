import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';

/** 僅決定當次下載名稱；null 表示沿用原預設，不修改共用成果或歷史紀錄。 */
export function exportFileName(
  value: unknown,
  type: 'excel' | 'zip' | 'pdf',
): string | null {
  if (value === undefined) return null;
  const invalid = () =>
    new AppException(...AppErrors.ESIGN_EXPORT_FILE_NAME_INVALID);
  if (typeof value !== 'string') throw invalid();
  // 必須在 trim 前拒絕換行，不能把標頭注入字元當作空白忽略。
  if (/[\\/\p{Cc}\p{Cf}<>:"|?*]/u.test(value)) throw invalid();
  const name = value.trim();
  if (!name) return null;
  if (Array.from(name).length > 100) throw invalid();
  const base = name.replace(/\.(xlsx|zip|pdf)$/i, '');
  if (
    !base.trim() ||
    /^[.]|[. ]$/.test(base) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)
  )
    throw invalid();
  const result = `${base}.${type === 'excel' ? 'xlsx' : type}`;
  if (Buffer.byteLength(result, 'utf8') > 255) throw invalid();
  return result;
}
