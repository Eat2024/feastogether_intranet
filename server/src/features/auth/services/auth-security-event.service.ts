import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { EntityManager } from 'typeorm';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { CLS_REQUEST_ID } from '#app/infrastructure/logging/requestId/request-id';
import type { Actor } from '../auth.types';
import type {
  AuthSecurityEventActorKind,
  AuthSecurityEventType,
  AuthSecurityOutcome,
} from '../entities/auth-security-event.entity';
import { AuthSecurityEventRepository } from '../repositories/auth-security-event.repository';

/** 只接受白名單欄位；帳號、密碼、IP、UA、body、入口、token 與指紋沒有欄位可放。 */
export interface AuthSecurityEventInput {
  type: AuthSecurityEventType;
  actor: Actor | { kind: Exclude<AuthSecurityEventActorKind, Actor['kind']> };
  outcome: AuthSecurityOutcome;
  sessionId?: number;
  credentialGeneration?: number | null;
  entryGeneration?: number;
}

@Injectable()
export class AuthSecurityEventService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly events: AuthSecurityEventRepository,
    private readonly cls: ClsService,
    private readonly logger: AppLoggerService,
  ) {}

  /** 與會話或維護異動同一交易寫入；寫入失敗時整筆交易一起 rollback。 */
  append(event: AuthSecurityEventInput, manager: EntityManager): Promise<void> {
    return this.events.append(
      {
        eventType: event.type,
        actorKind: event.actor.kind,
        actorUserId:
          event.actor.kind === 'employee' ? event.actor.userId : null,
        sessionId: event.sessionId ?? null,
        outcomeCode: event.outcome,
        credentialGeneration: event.credentialGeneration ?? null,
        entryGeneration: event.entryGeneration ?? null,
        requestId: this.cls.isActive()
          ? (this.cls.get<string>(CLS_REQUEST_ID) ?? null)
          : null,
        occurredAt: new Date(),
      },
      manager,
    );
  }

  /**
   * 帳密拒絕以獨立短交易記錄，不碰目前會話。DB 不可用時只記故障類別（requestId 由 logger 帶入），
   * 回 503 而不假裝事件已保存。
   */
  async recordRejection(event: AuthSecurityEventInput): Promise<void> {
    try {
      await this.mysql.transaction((manager) => this.append(event, manager));
    } catch {
      this.logger.warn({
        event: 'auth.security_event_unavailable',
        context: AuthSecurityEventService.name,
        message: '安全事件無法保存',
        metadata: { eventType: event.type },
      });
      throw new AppException(...AppErrors.AUTH_DB_UNAVAILABLE);
    }
  }
}
