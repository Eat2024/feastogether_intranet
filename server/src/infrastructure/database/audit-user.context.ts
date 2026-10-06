// audit-user.context.ts
// 「這個請求是誰在操作」的單一出處：CLS key 與它的兩種取用方式。
//
// 值由 AuthGuard 於驗證通過後寫入。讀取端分兩類，故提供兩支而非一支——
// 兩者的差別不是寫法偏好，是「沒有登入人」該不該算錯：
//
//   - clsUserId：取不到回 undefined。稽核欄（created_by/updated_by）與 log 欄屬
//     「有就記」；且 worker、排程與 console script 不經 HTTP，`cls.isActive()`
//     為 false 是正常狀態，不該丟錯。
//   - requireClsUserId：取不到即 401。操作人須綁登入身分的寫入端點用。
//     訊息固定一句：AuthGuard 已先擋下匿名請求，走到這裡代表端點漏掛 guard，
//     是工程缺陷而非使用者要分辨的業務語境，不值得讓每個呼叫端各帶一句。
//
// 放在 infrastructure 而非 common：本檔需要 common/errors，而 common 是最底層、
// 全專案無一處自 common 反向 import infrastructure，不能為了這支開先例。
import { HttpStatus } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';

/** CLS 中存放登入者 ID 的 key（由 AuthGuard 寫入）。 */
export const CLS_AUDIT_USER_ID = 'auditUserId';

/**
 * 登入人 id；無請求上下文或未登入時回 `undefined`。
 *
 * `cls.isActive()` 的判斷 MUST NOT 省略：CLS 未啟動時直接 `cls.get()` 會拋錯，
 * 而 worker／排程／CLI 本來就跑在沒有請求上下文的地方。
 */
export function clsUserId(cls: ClsService): string | undefined {
  return cls.isActive() ? cls.get<string>(CLS_AUDIT_USER_ID) : undefined;
}

/** 登入人 id；取不到即以 401 中斷（操作人須綁登入身分的寫入端點用）。 */
export function requireClsUserId(cls: ClsService): string {
  const userId = clsUserId(cls);
  if (!userId) {
    throw new AppException(
      AppErrorCode.UNAUTHORIZED,
      '需登入才能操作',
      HttpStatus.UNAUTHORIZED,
    );
  }
  return userId;
}
