import type { Actor } from '#app/features/auth/auth.types';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignDocumentField } from '#app/features/esign/entities/esign-document-field.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { CLS_AUDIT_ACTOR } from './audit-user.context';
import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import { UserAuditableEntity } from './user-auditable.entity';
import { MYSQL_MAIN } from './mysql/mysql.tokens';
import { clsUserId } from './audit-user.context';

@Injectable()
export class AuditSubscriber implements EntitySubscriberInterface {
  constructor(
    @Inject(MYSQL_MAIN) dataSource: DataSource,
    private readonly cls: ClsService,
  ) {
    dataSource.subscribers.push(this);
  }

  beforeInsert(event: InsertEvent<unknown>): void {
    const entity = event.entity;
    if (this.auditEsign(entity, true)) return;
    if (!(entity instanceof UserAuditableEntity)) return;

    const userId = clsUserId(this.cls);
    if (userId) {
      entity.createdByUserId = userId;
      entity.updatedByUserId = userId;
    }
  }

  beforeUpdate(event: UpdateEvent<unknown>): void {
    const entity = event.entity;
    if (this.auditEsign(entity, false)) return;
    if (!(entity instanceof UserAuditableEntity)) return;

    const userId = clsUserId(this.cls);
    if (userId) entity.updatedByUserId = userId;
  }
  private auditEsign(entity: unknown, insert: boolean): boolean {
    if (
      !(
        entity instanceof EsignDocument ||
        entity instanceof EsignDocumentField ||
        entity instanceof EsignSigner
      )
    )
      return false;
    const actor = this.cls.isActive()
      ? this.cls.get<Actor>(CLS_AUDIT_ACTOR)
      : undefined;
    if (actor) {
      if (insert) {
        entity.createdByActorKind = actor.kind;
        entity.createdByUserId =
          actor.kind === 'employee' ? actor.userId : null;
      }
      entity.updatedByActorKind = actor.kind;
      entity.updatedByUserId = actor.kind === 'employee' ? actor.userId : null;
    } else if (!(entity instanceof EsignDocument)) {
      if (insert && !entity.createdByActorKind)
        entity.createdByActorKind =
          entity.createdByUserId == null ? 'system' : 'employee';
      if (
        !entity.updatedByActorKind ||
        entity.updatedByActorKind === 'legacy_unknown'
      )
        entity.updatedByActorKind =
          entity.updatedByUserId == null ? 'system' : 'employee';
    }
    return true;
  }
}
