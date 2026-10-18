import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { AuditEventRepository } from '../repositories/audit-event.repository';
import { canonicalJson, EsignAuditService } from './esign-audit.service';

describe('EsignAuditService', () => {
  const manager = {} as EntityManager;

  const setup = (previousEventHash?: string) => {
    const calls: string[] = [];
    const repository = {
      lockDocument: jest.fn(async () => {
        calls.push('lock');
        return { id: 10 };
      }),
      findLatestDocumentEvent: jest.fn(async () => {
        calls.push('latest');
        return previousEventHash ? { eventHash: previousEventHash } : null;
      }),
      insert: jest.fn(async () => {
        calls.push('insert');
        return { identifiers: [] };
      }),
    };
    return {
      calls,
      repository,
      service: new EsignAuditService(
        repository as unknown as AuditEventRepository,
      ),
    };
  };

  it('canonical JSON 遞迴使用字典序 key 與 UTF-8 UTC ISO-8601', () => {
    expect(
      canonicalJson({ z: '中文', a: { d: 2, c: 1 }, time: new Date(0) }),
    ).toBe('{"a":{"c":1,"d":2},"time":"1970-01-01T00:00:00.000Z","z":"中文"}');
  });

  it('append 先 lock document，再讀 previous hash 並 insert', async () => {
    const { calls, repository, service } = setup('a'.repeat(64));
    const occurredAt = new Date('2026-10-13T01:02:03.456Z');
    const eventHash = await service.append(
      {
        documentId: 10,
        signerId: 20,
        actorUserId: 30,
        eventType: 'signature.completed',
        occurredAt,
        requestId: 'request-1',
        metadata: { consentVersion: 'esign-consent-v1' },
      },
      manager,
    );

    expect(calls).toEqual(['lock', 'latest', 'insert']);
    const inserted = repository.insert.mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      previousEventHash: 'a'.repeat(64),
      eventHash,
      occurredAt,
    });
    expect(eventHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('第一筆事件使用空 previous hash，重算結果一致', async () => {
    const { repository, service } = setup();
    const occurredAt = new Date('2026-10-13T00:00:00.000Z');
    const eventHash = await service.append(
      {
        documentId: 10,
        eventType: 'document.created',
        occurredAt,
      },
      manager,
    );
    const canonical = canonicalJson({
      actorUserId: null,
      documentId: 10,
      eventType: 'document.created',
      metadata: undefined,
      occurredAt: occurredAt.toISOString(),
      requestId: null,
      signerId: null,
    });
    expect(eventHash).toBe(
      createHash('sha256').update('').update(canonical).digest('hex'),
    );
    expect(
      repository.insert.mock.calls[0]?.[0].previousEventHash,
    ).toBeUndefined();
  });

  it('個人產物事件固定 record、檔案 ID 與摘要，不接受非法 owner metadata', async () => {
    const { repository, service } = setup();
    await service.append(
      {
        documentId: 10,
        signerId: 20,
        eventType: 'signer.copy_completed',
        occurredAt: new Date(),
        metadata: {
          signatureRecordId: 30,
          completedFileId: 40,
          completedPdfSha256: 'a'.repeat(64),
        },
      },
      manager,
    );
    expect(repository.insert.mock.calls[0]?.[0].metadataJson).toEqual({
      signatureRecordId: 30,
      completedFileId: 40,
      completedPdfSha256: 'a'.repeat(64),
    });
    await service.append(
      {
        documentId: 10,
        eventType: 'signer.copy_failed',
        occurredAt: new Date(),
        metadata: {
          signatureRecordId: -1,
          completedFileId: NaN,
          completedPdfSha256: 'not-a-hash',
        },
      },
      manager,
    );
    expect(repository.insert.mock.calls[1]?.[0].metadataJson).toBeUndefined();
  });

  it('metadata 只接受白名單，避免 Email、token、IP 與簽名進入 audit', async () => {
    const { repository, service } = setup();
    await service.append(
      {
        documentId: 10,
        eventType: 'document.finalization_failed',
        occurredAt: new Date(),
        metadata: {
          errorCode: 'PDF_GENERATION_FAILED',
          ...({
            email: 'person@example.com',
            token: 'secret',
            sourceIp: '127.0.0.1',
            png: 'data:image/png;base64,secret',
          } as Record<string, string>),
        },
      },
      manager,
    );

    expect(repository.insert.mock.calls[0]?.[0].metadataJson).toEqual({
      errorCode: 'PDF_GENERATION_FAILED',
    });
  });
});
