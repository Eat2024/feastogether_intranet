import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { CLS_REQUEST_ID } from '#app/infrastructure/logging/requestId/request-id';
import type { AuthSecurityEvent } from '../entities/auth-security-event.entity';
import { AuthSecurityEventService } from './auth-security-event.service';

function setup(options: { clsActive?: boolean; failTransaction?: boolean }) {
  const stored: Array<Partial<AuthSecurityEvent>> = [];
  const manager = {};
  const mysql = {
    transaction: jest.fn(async (run: (m: object) => Promise<void>) => {
      if (options.failTransaction) throw new Error('db down');
      await run(manager);
    }),
  };
  const repository = {
    append: jest.fn((event: Partial<AuthSecurityEvent>) => {
      stored.push(event);
      return Promise.resolve();
    }),
  };
  const cls = {
    isActive: () => options.clsActive ?? false,
    get: (key: string) => (key === CLS_REQUEST_ID ? 'req-1' : undefined),
  };
  const logger = { warn: jest.fn() };
  const service = new AuthSecurityEventService(
    mysql as never,
    repository as never,
    cls as never,
    logger as never,
  );
  return { service, stored, manager, logger };
}

describe('AuthSecurityEventService', () => {
  it('只有員工事件帶員工 ID；有請求上下文時帶 requestId', async () => {
    const { service, stored, manager } = setup({ clsActive: true });

    await service.append(
      {
        type: 'login.succeeded',
        actor: { kind: 'employee', userId: 7 },
        outcome: 'succeeded',
        sessionId: 3,
      },
      manager as never,
    );
    await service.append(
      {
        type: 'login.succeeded',
        actor: { kind: 'super_user' },
        outcome: 'succeeded',
        sessionId: 4,
        credentialGeneration: 2,
      },
      manager as never,
    );

    expect(stored).toEqual([
      {
        eventType: 'login.succeeded',
        actorKind: 'employee',
        actorUserId: 7,
        sessionId: 3,
        outcomeCode: 'succeeded',
        credentialGeneration: null,
        entryGeneration: null,
        requestId: 'req-1',
        occurredAt: expect.any(Date) as unknown,
      },
      expect.objectContaining({
        actorKind: 'super_user',
        actorUserId: null,
        credentialGeneration: 2,
      }),
    ]);
  });

  it('console／worker 無請求上下文時 requestId 為 null', async () => {
    const { service, stored, manager } = setup({ clsActive: false });
    await service.append(
      {
        type: 'entry.initialized',
        actor: { kind: 'operator' },
        outcome: 'succeeded',
        entryGeneration: 1,
      },
      manager as never,
    );
    expect(stored[0]).toMatchObject({ actorKind: 'operator', requestId: null });
  });

  it('帳密拒絕以獨立交易寫入', async () => {
    const { service, stored } = setup({});
    await service.recordRejection({
      type: 'login.rejected',
      actor: { kind: 'anonymous' },
      outcome: 'credentials_invalid',
    });
    expect(stored).toEqual([
      expect.objectContaining({
        eventType: 'login.rejected',
        actorKind: 'anonymous',
        outcomeCode: 'credentials_invalid',
      }),
    ]);
  });

  it('拒絕事件無法保存時回 503，log 只記故障類別', async () => {
    const { service, logger } = setup({ failTransaction: true });
    await expect(
      service.recordRejection({
        type: 'login.rejected',
        actor: { kind: 'anonymous' },
        outcome: 'credentials_invalid',
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.AUTH_DB_UNAVAILABLE,
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(logger.warn).toHaveBeenCalledWith({
      event: 'auth.security_event_unavailable',
      context: 'AuthSecurityEventService',
      message: '安全事件無法保存',
      metadata: { eventType: 'login.rejected' },
    });
  });
});
