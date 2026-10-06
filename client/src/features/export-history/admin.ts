// 管理者判斷（僅供伺服器端使用）
// TODO: 串接登入與權限系統後改由角色判斷；目前以環境變數 ADMIN_EMPLOYEE_IDS（逗號分隔的員工編號）設定
import { getCurrentUserId } from '@/features/forms/orgChart';

const DEFAULT_ADMIN_IDS = ['11506071'];

function adminIds(): string[] {
  const env = process.env.ADMIN_EMPLOYEE_IDS?.split(',').map((s) => s.trim()).filter(Boolean);
  return env?.length ? env : DEFAULT_ADMIN_IDS;
}

export function isAdmin(userId: string = getCurrentUserId()): boolean {
  return adminIds().includes(userId);
}
