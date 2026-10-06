import { ACTION_LABEL, ACTION_ORDER } from '#app/features/auth/auth.constants';
import {
  PERMISSION_DICTIONARY,
  PERMISSION_KEY_ENUMS,
} from './permission-dictionary';

/**
 * 權限鍵 enum ↔ 字典 drift 防護（2026-07-25）。
 * 各 job 權限 enum（供 @RegisterApi 引用）為手寫常數——本 spec 逐值驗證與
 * PERMISSION_DICTIONARY（單一事實來源）一致：字典改 key/刪權限而 enum 未同步、
 * 或 enum 打錯字，CI 即紅（否則會是執行期悄悄 403）。
 */
describe('permission-dictionary 權限鍵 enum drift 防護', () => {
  const dictionaryKeys = new Set(
    PERMISSION_DICTIONARY.flatMap((group) => group.jobs).flatMap((job) =>
      job.permissions.map((p) => p.permissionKey),
    ),
  );

  it.each(Object.entries(PERMISSION_KEY_ENUMS))(
    'enum %s 的每個值都存在於字典',
    (_name, enumObject) => {
      for (const value of Object.values(enumObject)) {
        expect(dictionaryKeys).toContain(value);
      }
    },
  );

  it('字典的每個 permissionKey 都有對應 enum 值（雙向：新增權限勿漏建 enum）', () => {
    const enumValues = new Set(
      Object.values(PERMISSION_KEY_ENUMS).flatMap(
        (enumObject: Record<string, string>) => Object.values(enumObject),
      ),
    );
    for (const key of dictionaryKeys) {
      expect(enumValues).toContain(key);
    }
  });

  /**
   * 曾發生的實例：新 action 加進字典與 seed 後，`ACTION_ORDER` 沒同步——DB 有那列、
   * guard 也要求它，但 `toPermissionCatalog` 以 ACTION_ORDER 為欄序來源，
   * 該權限在 `GET /roles/:id/permissions` 完全不出現，角色管理頁因此勾不到。
   * 全綠、零型別錯誤，只有打 API 才會發現——故補此守門。
   */
  it('字典用到的每個 action 都在 ACTION_ORDER 內（否則權限目錄 API 會漏該欄）', () => {
    const dictionaryActions = new Set(
      PERMISSION_DICTIONARY.flatMap((group) => group.jobs).flatMap((job) =>
        job.permissions.map((p) => p.action),
      ),
    );
    for (const action of dictionaryActions) {
      expect(ACTION_ORDER as readonly string[]).toContain(action);
      // label 缺漏會讓前端顯示原始 action 字串（如「printExport」）而非中文
      expect(ACTION_LABEL[action as keyof typeof ACTION_LABEL]).toBeTruthy();
    }
  });
});
