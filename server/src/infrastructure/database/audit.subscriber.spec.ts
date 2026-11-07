import type { Actor } from '#app/features/auth/auth.types';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignDocumentField } from '#app/features/esign/entities/esign-document-field.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { Department } from '#app/features/users/entities/department.entity';
import { CLS_AUDIT_ACTOR } from './audit-user.context';
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

describe('電子簽局部 actor 稽核', () => {
  const createSubscriber = (actor?: Actor) =>
    new AuditSubscriber(
      { subscribers: [] } as unknown as DataSource,
      {
        isActive: () => !!actor,
        get: (key: string) =>
          key === CLS_AUDIT_ACTOR
            ? actor
            : actor?.kind === 'employee'
              ? actor.userId
              : undefined,
      } as unknown as ClsService,
    );
  it.each([EsignDocument, EsignDocumentField, EsignSigner])(
    'HTTP Super 寫入 %p 不造假員工，更新不覆寫建立人或指定簽署人',
    (Entity) => {
      const entity = Object.assign(new Entity(), {
        createdByActorKind: 'legacy_unknown',
        createdByUserId: 12,
        updatedByUserId: 12,
        userId: 35,
      });
      const subscriber = createSubscriber({ kind: 'super_user' });
      subscriber.beforeInsert({ entity } as InsertEvent<unknown>);
      expect(entity).toMatchObject({
        createdByActorKind: 'super_user',
        createdByUserId: null,
        updatedByActorKind: 'super_user',
        updatedByUserId: null,
        userId: 35,
      });
      entity.createdByActorKind = 'employee';
      entity.createdByUserId = 12;
      subscriber.beforeUpdate({ entity } as UpdateEvent<unknown>);
      expect(entity).toMatchObject({
        createdByActorKind: 'employee',
        createdByUserId: 12,
        updatedByActorKind: 'super_user',
        updatedByUserId: null,
        userId: 35,
      });
    },
  );
  it('員工 HTTP 覆寫 legacy_unknown；Department 維持共用員工稽核規則', () => {
    const subscriber = createSubscriber({ kind: 'employee', userId: 42 });
    const field = Object.assign(new EsignDocumentField(), {
      createdByActorKind: 'legacy_unknown',
      updatedByActorKind: 'legacy_unknown',
    });
    subscriber.beforeInsert({ entity: field } as InsertEvent<unknown>);
    expect(field).toMatchObject({
      createdByActorKind: 'employee',
      updatedByActorKind: 'employee',
      createdByUserId: 42,
      updatedByUserId: 42,
    });
    const department = new Department();
    subscriber.beforeInsert({ entity: department } as InsertEvent<unknown>);
    expect(department).toMatchObject({
      createdByUserId: 42,
      updatedByUserId: 42,
    });
    createSubscriber({ kind: 'super_user' }).beforeUpdate({
      entity: department,
    } as UpdateEvent<unknown>);
    expect(department.updatedByUserId).toBe(42);
    expect(department).not.toHaveProperty('updatedByActorKind');
  });
  it('無 HTTP 的新欄位明確標記 system，不猜測文件歷史管理者', () => {
    const subscriber = createSubscriber();
    const field = new EsignDocumentField();
    const document = new EsignDocument();
    subscriber.beforeInsert({ entity: field } as InsertEvent<unknown>);
    subscriber.beforeUpdate({ entity: document } as UpdateEvent<unknown>);
    expect(field).toMatchObject({
      createdByActorKind: 'system',
      updatedByActorKind: 'system',
    });
    expect(document.updatedByActorKind).toBeUndefined();
  });
});
