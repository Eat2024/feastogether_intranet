import { getMetadataArgsStorage } from 'typeorm';
import { AuthUser } from './auth-user.entity';

const columns = () =>
  getMetadataArgsStorage().columns.filter(
    (column) => column.target === AuthUser,
  );

const indices = () =>
  getMetadataArgsStorage().indices.filter((index) => index.target === AuthUser);

describe('AuthUser entity metadata', () => {
  // 2026-09-04 盤點：titleId／sourceSystem／sourceSyncedAt 皆無完整消費路徑
  // （titleId 全域零引用、另兩者只寫不讀），已隨 auth_titles 主檔一併移除。
  it('移除 tokensValidAfter 與無消費路徑的 titleId／source* 欄位', () => {
    const propertyNames = columns().map((column) => column.propertyName);

    expect(propertyNames).not.toContain('tokensValidAfter');
    expect(propertyNames).not.toContain('titleId');
    expect(propertyNames).not.toContain('sourceSystem');
    expect(propertyNames).not.toContain('sourceSyncedAt');
    // 顯示用的冗餘欄仍保留（登入同步寫入、畫面讀取）
    expect(propertyNames).toContain('titleName');
    expect(propertyNames).toContain('departmentName');
  });

  it('保留 personEmpid 唯一約束且不建立額外一般 index', () => {
    const empIdIndexes = indices().filter((index) =>
      toColumnNames(index.columns).includes('personEmpid'),
    );

    expect(empIdIndexes).toHaveLength(1);
    expect(empIdIndexes[0]).toMatchObject({
      name: 'uq_auth_users_person_empid',
    });
  });

  // title_id 欄位與其索引已於 1788200000008 移除（全域零引用、auth_titles 主檔亦已刪）。
  it('建立 department 查詢索引，不建立 title / user brand 直接索引', () => {
    const indexNames = indices().map((index) => index.name);
    const indexedColumns = indices().flatMap((index) =>
      toColumnNames(index.columns),
    );

    expect(indexNames).toEqual(
      expect.arrayContaining(['idx_auth_users_department_code']),
    );
    expect(indexNames).not.toContain('idx_auth_users_title_id');
    expect(indexedColumns).not.toContain('brandId');
    expect(indexedColumns).not.toContain('brandCode');
    expect(indexedColumns).not.toContain('brandName');
  });
});

function toColumnNames(columns: unknown): string[] {
  if (typeof columns === 'string') return [columns];
  if (Array.isArray(columns)) return columns.filter(isString);
  return [];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
