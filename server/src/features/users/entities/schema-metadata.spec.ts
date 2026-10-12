import { getMetadataArgsStorage } from 'typeorm';
import { Department } from './department.entity';
import { User } from './user.entity';

describe('user schema metadata', () => {
  const storage = getMetadataArgsStorage();

  it.each([
    [Department, 'hr_departments'],
    [User, 'users'],
  ])('%p 對應 %s 且欄位有繁中 comment', (target, tableName) => {
    const table = storage.tables.find((item) => item.target === target);
    expect(table?.name).toBe(tableName);
    expect(
      storage.columns
        .filter((column) => column.target === target)
        .every((column) =>
          /[\u3400-\u9fff]/u.test(column.options.comment ?? ''),
        ),
    ).toBe(true);
  });

  it.each([
    [Department, 'idx_hr_departments_start_date', 'startDate'],
    [Department, 'idx_hr_departments_stop_date', 'stopDate'],
    [Department, 'idx_hr_departments_created_at', 'createdAt'],
    [Department, 'idx_hr_departments_updated_at', 'updatedAt'],
    [Department, 'idx_hr_departments_deleted_at', 'deletedAt'],
    [User, 'idx_users_last_login_at', 'lastLoginAt'],
    [User, 'idx_users_created_at', 'createdAt'],
    [User, 'idx_users_updated_at', 'updatedAt'],
    [User, 'idx_users_deleted_at', 'deletedAt'],
  ])('%s 是專屬單欄索引', (target, name, property) => {
    expect(
      storage.indices.find(
        (index) => index.target === target && index.name === name,
      )?.columns,
    ).toEqual([property]);
  });
});
