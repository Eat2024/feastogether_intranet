import { SetMetadata } from '@nestjs/common';

/** @RegisterApi() metadata key。 */
export const REGISTER_API_KEY = 'rbac:registerApi';

/**
 * 受保護端點的權限宣告（唯一事實來源）。
 * - key：api_key，全域唯一，例 `roles.rename`
 * - name：顯示名稱
 * - permissions：可呼叫此端點的權限鍵（OR 語意），例 `['roleManagement.createEdit']`；
 *   空陣列 `[]` = 僅需登入（任何有效身分皆可，如 `/auth/me`）。
 */
export interface RegisterApiMetadata {
  key: string;
  name: string;
  permissions: string[];
}

/** 宣告受保護端點 + 其預設權限對應；開機冪等同步至 auth_apis / auth_api_permissions。 */
export const RegisterApi = (meta: RegisterApiMetadata) =>
  SetMetadata(REGISTER_API_KEY, meta);
