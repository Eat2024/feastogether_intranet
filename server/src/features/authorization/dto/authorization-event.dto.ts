/** 管理回應僅揭露授權設定，不含 request id 或原始員工／憑證。 */
export interface AuthorizationEventDto {
  id: string;
  occurredAt: string;
  actorKind: 'super_user' | 'operator' | 'system';
  source: 'http' | 'repl' | 'migration';
  moduleKey: string;
  eventType: string;
  targetKind: 'role' | 'user' | 'catalog';
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
