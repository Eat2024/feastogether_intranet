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
    if (!(entity instanceof UserAuditableEntity)) return;

    const userId = clsUserId(this.cls);
    if (userId) {
      entity.createdByUserId = userId;
      entity.updatedByUserId = userId;
    }
  }

  beforeUpdate(event: UpdateEvent<unknown>): void {
    const entity = event.entity;
    if (!(entity instanceof UserAuditableEntity)) return;

    const userId = clsUserId(this.cls);
    if (userId) entity.updatedByUserId = userId;
  }
}
