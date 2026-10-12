import { ClsService } from 'nestjs-cls';
import type { DataSource, InsertEvent, UpdateEvent } from 'typeorm';
import { AuditSubscriber } from './audit.subscriber';
import { UserAuditableEntity } from './user-auditable.entity';

class TestUserAuditableEntity extends UserAuditableEntity {}

describe('AuditSubscriber', () => {
  const subscribers: unknown[] = [];
  const dataSource = { subscribers } as unknown as DataSource;

  beforeEach(() => subscribers.splice(0));

  it('insert 時寫入 user actor id', () => {
    const cls = {
      isActive: () => true,
      get: () => 42,
    } as unknown as ClsService;
    const subscriber = new AuditSubscriber(dataSource, cls);
    const entity = new TestUserAuditableEntity();

    subscriber.beforeInsert({ entity } as InsertEvent<unknown>);

    expect(entity.createdByUserId).toBe(42);
    expect(entity.updatedByUserId).toBe(42);
  });

  it('update 時只寫入 updated user actor id', () => {
    const cls = {
      isActive: () => true,
      get: () => 84,
    } as unknown as ClsService;
    const subscriber = new AuditSubscriber(dataSource, cls);
    const entity = new TestUserAuditableEntity();

    subscriber.beforeUpdate({ entity } as UpdateEvent<unknown>);

    expect(entity.createdByUserId).toBeUndefined();
    expect(entity.updatedByUserId).toBe(84);
  });

  it('沒有 request context 時不寫入 actor', () => {
    const cls = { isActive: () => false } as unknown as ClsService;
    const subscriber = new AuditSubscriber(dataSource, cls);
    const entity = new TestUserAuditableEntity();

    subscriber.beforeInsert({ entity } as InsertEvent<unknown>);

    expect(entity.createdByUserId).toBeUndefined();
    expect(entity.updatedByUserId).toBeUndefined();
  });
});
