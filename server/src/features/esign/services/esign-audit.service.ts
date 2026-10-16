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

/** canonical JSON 的 SHA-256；簽署 payload 與驗證 manifest 的證據識別共用。 */
export function canonicalSha256(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

export interface EsignAuditHashInput {
  documentId: number;
  signerId?: number | null;
  actorUserId?: number | null;
  eventType: string;
  occurredAt: Date;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** 稽核事件 hash：前一筆 event hash 串接本筆 canonical JSON；寫入與驗證共用。 */
export function auditEventHash(
  previousEventHash: string | null | undefined,
  event: EsignAuditHashInput,
): string {
  const eventBytes = canonicalJson({
    actorUserId: event.actorUserId ?? null,
    documentId: event.documentId,
    eventType: event.eventType,
    metadata: event.metadata ?? undefined,
    occurredAt: event.occurredAt.toISOString(),
    requestId: event.requestId ?? null,
    signerId: event.signerId ?? null,
  });
  return createHash('sha256')
    .update(previousEventHash ?? '', 'utf8')
    .update(eventBytes, 'utf8')
    .digest('hex');
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
    const eventHash = auditEventHash(previous?.eventHash, {
      ...input,
      metadata,
    });

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
