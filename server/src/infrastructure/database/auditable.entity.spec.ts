import { getMetadataArgsStorage } from 'typeorm';
import { BaseEntity } from './base.entity';
import { AuditableEntity } from './auditable.entity';
import { UserAuditableEntity } from './user-auditable.entity';

function column(target: object, propertyName: string) {
  return getMetadataArgsStorage().columns.find(
    (item) => item.target === target && item.propertyName === propertyName,
  );
}

describe('database entity bases', () => {
  it('所有共用時間欄位使用 DATETIME(6)', () => {
    expect(column(BaseEntity, 'createdAt')?.options).toMatchObject({
      type: 'datetime',
      precision: 6,
    });
    expect(column(AuditableEntity, 'updatedAt')?.options).toMatchObject({
      type: 'datetime',
      precision: 6,
    });
    expect(column(AuditableEntity, 'deletedAt')?.options).toMatchObject({
      type: 'datetime',
      precision: 6,
    });
  });

  it('一般 auditable base 不再帶 actor 欄位', () => {
    expect(column(AuditableEntity, 'createdBy')).toBeUndefined();
    expect(column(AuditableEntity, 'updatedBy')).toBeUndefined();
  });

  it('user-auditable actor 使用 nullable BIGINT', () => {
    expect(
      column(UserAuditableEntity, 'createdByUserId')?.options,
    ).toMatchObject({ type: 'bigint', nullable: true });
    expect(
      column(UserAuditableEntity, 'updatedByUserId')?.options,
    ).toMatchObject({ type: 'bigint', nullable: true });
  });
});
