import { getMetadataArgsStorage } from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';
import { BaseEntity } from '#app/infrastructure/database/base.entity';
import { User } from './user.entity';

describe('User entity metadata', () => {
  const storage = getMetadataArgsStorage();
  const ownColumns = storage.columns.filter((column) =>
    [User, AuditableEntity, BaseEntity].includes(column.target as never),
  );

  it('使用 users 作唯一 principal table', () => {
    expect(storage.tables.find((table) => table.target === User)?.name).toBe(
      'users',
    );
    const uniqueIndex = storage.indices.find(
      (index) => index.target === User && index.name === 'uq_users_empid',
    );
    const uniqueConstraint = storage.uniques.find(
      (unique) => unique.target === User && unique.name === 'uq_users_empid',
    );
    expect(uniqueIndex?.unique ?? !!uniqueConstraint).toBe(true);
  });

  it('只包含登入與電子簽需要的員工欄位', () => {
    const columns = ownColumns.map(
      (column) => column.options.name ?? column.propertyName,
    );

    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'empid',
        'name',
        'person_status',
        'is_active',
        'department_id',
        'department_name',
        'title_name',
        'last_login_at',
        'created_at',
        'updated_at',
        'deleted_at',
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        'role_id',
        'description',
        'password',
        'oauth_sub',
      ]),
    );
  });

  it.each([
    ['idx_users_last_login_at', 'lastLoginAt'],
    ['idx_users_created_at', 'createdAt'],
    ['idx_users_updated_at', 'updatedAt'],
    ['idx_users_deleted_at', 'deletedAt'],
  ])('%s 是 %s 的專屬單欄索引', (name, property) => {
    const index = storage.indices.find(
      (item) => item.target === User && item.name === name,
    );

    expect(index?.columns).toEqual([property]);
  });
});
