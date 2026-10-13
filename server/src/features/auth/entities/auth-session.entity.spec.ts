import { getMetadataArgsStorage } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';
import { AuthSession } from './auth-session.entity';

describe('AuthSession entity metadata', () => {
  it('使用 auth_sessions、AuditableEntity 與必要欄位', () => {
    expect(new AuthSession()).toBeInstanceOf(AuditableEntity);
    const storage = getMetadataArgsStorage();
    expect(
      storage.tables.find((table) => table.target === AuthSession)?.name,
    ).toBe('auth_sessions');
    expect(
      storage.columns
        .filter((column) => column.target === AuthSession)
        .every((column) =>
          /[\u3400-\u9fff]/u.test(column.options.comment ?? ''),
        ),
    ).toBe(true);
    const names = storage.columns
      .filter((column) => column.target === AuthSession)
      .map((column) => column.options.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'user_id',
        'source',
        'status',
        'source_jti_hash',
        'launch_code_hash',
        'session_token_hash',
        'assertion_expires_at',
        'launch_expires_at',
        'verified_at',
        'activated_at',
        'expires_at',
        'revoked_at',
        'failure_code',
      ]),
    );
    expect(
      storage.columns.find(
        (column) =>
          column.target === AuthSession && column.options.name === 'source',
      )?.options.default,
    ).toBeUndefined();
  });

  it('具三個 unique 與 lifecycle 複合索引', () => {
    const indexes = getMetadataArgsStorage().indices.filter(
      (index) => index.target === AuthSession,
    );
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'uq_auth_sessions_source_jti_hash',
        'uq_auth_sessions_launch_code_hash',
        'uq_auth_sessions_session_token_hash',
        'idx_auth_sessions_status_launch_expires_at',
        'idx_auth_sessions_status_expires_at',
        'idx_auth_sessions_user_created_at',
        'idx_auth_sessions_deleted_at',
      ]),
    );
    expect(indexes.filter((index) => index.unique)).toHaveLength(3);
  });
});
