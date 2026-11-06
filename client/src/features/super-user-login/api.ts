// 隱藏維護登入專用的 API：只由這個 feature 引用，不放進共用的 src/api，
// 員工頁與公開頁的 bundle 不會含這些路徑與型別；錯誤碼判斷在 SuperUserLoginForm。
// 後端：server/src/features/auth/controllers/super-user-access.controller.ts
import api from '@/api/config';

/** 帳密原樣送出，不 trim */
export interface SuperUserLoginBody {
  account: string;
  password: string;
}

/**
 * @name Super user 登入
 * @description 成功回 201 並以 HttpOnly cookie 替換目前會話；帳密錯誤 401、入口失效 404、
 * 同一舊會話已被其他登入取代 409、過於頻繁 429（Retry-After 秒數）
 */
export const createSuperUserSession = async ({
  entryKey,
  ...body
}: SuperUserLoginBody & { entryKey: string }): Promise<void> => {
  await api({
    method: 'POST',
    url: `auth/super-user-entries/${encodeURIComponent(entryKey)}/sessions`,
    data: body,
  });
};
