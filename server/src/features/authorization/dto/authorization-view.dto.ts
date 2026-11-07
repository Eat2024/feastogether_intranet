/** 本人能力只公開最小身分與排序後的權限，不包含角色或員工資料。 */
export interface AuthorizationViewDto {
  actor:
    | { kind: 'employee'; userId: number }
    | { kind: 'super_user'; displayName: 'Super user' };
  modules: Array<{ moduleKey: string; permissions: string[] }>;
}
