import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { AuditEventRepository } from '../repositories/audit-event.repository';

export interface EsignAuditMetadata {
  status?: string;
  reason?: string;
  consentVersion?: string;
  errorCode?: string;
}

export interface AppendEsignAuditEvent {
  documentId: number;
  signerId?: number;
  actorUserId?: number;
  eventType: string;
  occurredAt: Date;
  requestId?: string;
  metadata?: EsignAuditMetadata;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

@Injectable()
export class EsignAuditService {
  constructor(private readonly repository: AuditEventRepository) {}

  async append(
    input: AppendEsignAuditEvent,
    manager: EntityManager,
  ): Promise<string> {
    const document = await this.repository.lockDocument(
      input.documentId,
      manager,
    );
    if (!document) {
      throw new AppException(
        AppErrorCode.ESIGN_RESOURCE_NOT_FOUND,
        '找不到電子簽資源',
        HttpStatus.NOT_FOUND,
      );
    }

    const previous = await this.repository.findLatestDocumentEvent(
      input.documentId,
      manager,
    );
    const metadata = this.sanitizeMetadata(input.metadata);
    const eventBytes = canonicalJson({
      actorUserId: input.actorUserId ?? null,
      documentId: input.documentId,
      eventType: input.eventType,
      metadata,
      occurredAt: input.occurredAt.toISOString(),
      requestId: input.requestId ?? null,
      signerId: input.signerId ?? null,
    });
    const eventHash = createHash('sha256')
      .update(previous?.eventHash ?? '', 'utf8')
      .update(eventBytes, 'utf8')
      .digest('hex');

    await this.repository.insert(
      {
        documentId: input.documentId,
        signerId: input.signerId,
        actorUserId: input.actorUserId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        previousEventHash: previous?.eventHash,
        eventHash,
        requestId: input.requestId,
        metadataJson: metadata,
      },
      manager,
    );
    return eventHash;
  }

  private sanitizeMetadata(
    metadata: EsignAuditMetadata | undefined,
  ): Record<string, string> | undefined {
    if (!metadata) return undefined;
    const result: Record<string, string> = {};
    for (const key of [
      'status',
      'reason',
      'consentVersion',
      'errorCode',
    ] as const) {
      const value = metadata[key];
      if (typeof value === 'string' && value.trim() !== '') {
        result[key] = value.slice(0, 500);
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
}
