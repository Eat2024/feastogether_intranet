import { SetMetadata } from '@nestjs/common';

/**
 * 需要會話的端點預設只接受員工；只有明確標記的路由（目前身分、登出）接受 Super user。
 * 員工業務授權接入前（028），Super user 存取其他端點一律 403。
 */
export const ALLOW_SUPER_USER_KEY = 'allowSuperUser';
export const AllowSuperUser = () => SetMetadata(ALLOW_SUPER_USER_KEY, true);
