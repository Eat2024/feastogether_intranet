import { getMetadataArgsStorage } from 'typeorm';
import { EsignAuditEvent } from './esign-audit-event.entity';
import { EsignDocumentField } from './esign-document-field.entity';
import { EsignDocument } from './esign-document.entity';
import { EsignExportJob } from './esign-export-job.entity';
import { EsignFileObject } from './esign-file-object.entity';
import { EsignNotificationBatch } from './esign-notification-batch.entity';
import { EsignNotificationLog } from './esign-notification-log.entity';
import { EsignSignatureRecord } from './esign-signature-record.entity';
import { EsignSigner } from './esign-signer.entity';
import { EsignVerificationRecord } from './esign-verification-record.entity';

describe('esign schema metadata', () => {
  const storage = getMetadataArgsStorage();
  const tables = [
    [EsignDocument, 'esign_documents'],
    [EsignDocumentField, 'esign_document_fields'],
    [EsignSigner, 'esign_signers'],
    [EsignSignatureRecord, 'esign_signature_records'],
    [EsignFileObject, 'esign_file_objects'],
    [EsignAuditEvent, 'esign_audit_events'],
    [EsignVerificationRecord, 'esign_verification_records'],
    [EsignNotificationBatch, 'esign_notification_batches'],
    [EsignNotificationLog, 'esign_notification_logs'],
    [EsignExportJob, 'esign_export_jobs'],
  ] as const;

  it.each(tables)('%p 對應 %s 且欄位有繁中 comment', (target, name) => {
    const table = storage.tables.find((item) => item.target === target);
    expect(table?.name).toBe(name);
    const comments = storage.columns
      .filter((column) => column.target === target)
      .map((column) => column.options.comment ?? '');
    expect(comments.every(Boolean)).toBe(true);
    expect(comments.some((comment) => /[\u3400-\u9fff]/u.test(comment))).toBe(
      true,
    );
  });

  const timeIndexes = [
    [EsignDocument, 'sign_start_at', 'signStartAt'],
    [EsignDocument, 'sign_end_at', 'signEndAt'],
    [EsignDocument, 'initiated_at', 'initiatedAt'],
    [EsignDocument, 'completed_at', 'completedAt'],
    [EsignDocument, 'stopped_at', 'stoppedAt'],
    [EsignDocument, 'created_at', 'createdAt'],
    [EsignDocument, 'updated_at', 'updatedAt'],
    [EsignDocument, 'deleted_at', 'deletedAt'],
    [EsignDocumentField, 'created_at', 'createdAt'],
    [EsignDocumentField, 'updated_at', 'updatedAt'],
    [EsignDocumentField, 'deleted_at', 'deletedAt'],
    [EsignSigner, 'signed_at', 'signedAt'],
    [EsignSigner, 'rejected_at', 'rejectedAt'],
    [EsignSigner, 'invitation_expires_at', 'invitationExpiresAt'],
    [EsignSigner, 'invitation_delivered_at', 'invitationDeliveredAt'],
    [EsignSigner, 'completion_lease_expires_at', 'completionLeaseExpiresAt'],
    [EsignSigner, 'completion_ready_at', 'completionReadyAt'],
    [EsignSigner, 'created_at', 'createdAt'],
    [EsignSigner, 'updated_at', 'updatedAt'],
    [EsignSigner, 'deleted_at', 'deletedAt'],
    [EsignSignatureRecord, 'signed_at_utc', 'signedAtUtc'],
    [EsignSignatureRecord, 'created_at', 'createdAt'],
    [EsignFileObject, 'created_at', 'createdAt'],
    [EsignAuditEvent, 'occurred_at', 'occurredAt'],
    [EsignAuditEvent, 'created_at', 'createdAt'],
    [EsignVerificationRecord, 'issued_at', 'issuedAt'],
    [EsignVerificationRecord, 'revoked_at', 'revokedAt'],
    [EsignVerificationRecord, 'created_at', 'createdAt'],
    [EsignNotificationBatch, 'created_at', 'createdAt'],
    [EsignNotificationLog, 'created_at', 'createdAt'],
    [EsignNotificationLog, 'completed_at', 'completedAt'],
    [EsignNotificationLog, 'next_attempt_at', 'nextAttemptAt'],
    [EsignNotificationLog, 'processing_started_at', 'processingStartedAt'],
    [EsignExportJob, 'created_at', 'createdAt'],
    [EsignExportJob, 'updated_at', 'updatedAt'],
    [EsignExportJob, 'completed_at', 'completedAt'],
  ] as const;

  it.each(timeIndexes)(
    '%p.%s 有固定名稱專屬單欄索引',
    (target, column, property) => {
      const table = storage.tables.find((item) => item.target === target)?.name;
      expect(
        storage.indices.find(
          (index) =>
            index.target === target && index.name === `idx_${table}_${column}`,
        )?.columns,
      ).toEqual([property]);
    },
  );

  it('文件 CHECK 同時保留已到期與永久停止', () => {
    const check = storage.checks.find(
      (entry) =>
        entry.target === EsignDocument &&
        entry.name === 'chk_esign_documents_status',
    );
    expect(check?.expression).toContain("'expired'");
    expect(check?.expression).toContain("'stopped'");
  });

  it('append-only signature/audit 不含更新與軟刪除欄位', () => {
    for (const target of [EsignSignatureRecord, EsignAuditEvent]) {
      const properties = storage.columns
        .filter((column) => column.target === target)
        .map((column) => column.propertyName);
      expect(properties).not.toEqual(
        expect.arrayContaining(['updatedAt', 'deletedAt']),
      );
    }
  });

  it('boolean defaults、decimal string 與 ASCII binary 證據欄位固定', () => {
    const column = (target: object, propertyName: string) =>
      storage.columns.find(
        (item) => item.target === target && item.propertyName === propertyName,
      )?.options;

    expect(column(EsignDocument, 'watermarkEnabled')?.default).toBe(false);
    expect(column(EsignDocument, 'allowReject')?.default).toBe(false);
    expect(column(EsignDocumentField, 'xPercent')).toMatchObject({
      type: 'decimal',
      precision: 6,
      scale: 3,
    });
    for (const [target, property] of [
      [EsignDocument, 'docNumber'],
      [EsignSigner, 'publicId'],
      [EsignSigner, 'invitationTokenSha256'],
      [EsignSigner, 'completionLeaseToken'],
      [EsignSignatureRecord, 'documentSha256'],
      [EsignAuditEvent, 'eventHash'],
      [EsignVerificationRecord, 'publicId'],
    ] as const) {
      expect(column(target, property)).toMatchObject({
        charset: 'ascii',
        collation: 'ascii_bin',
      });
    }
  });

  it('Spec 03 欄位關聯、冪等索引與狀態檢查已註冊', () => {
    const indexNames = storage.indices.map((index) => index.name);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'uq_esign_signers_public_id',
        'uq_esign_signers_invitation_token_sha256',
        'uq_esign_file_objects_completed_signature',
        'idx_esign_signers_completion_status_id',
        'uq_esign_file_objects_document_purpose',
        'uq_esign_file_objects_signature_field_purpose',
        'idx_esign_notification_logs_result_next_attempt_id',
      ]),
    );

    const checkNames = storage.checks.map((check) => check.name);
    expect(checkNames).toEqual(
      expect.arrayContaining([
        'chk_esign_documents_status',
        'chk_esign_documents_sign_period',
        'chk_esign_signers_status',
        'chk_esign_document_fields_bounds',
        'chk_esign_file_objects_signature_field',
        'chk_esign_notification_logs_channel',
        'chk_esign_notification_logs_result',
      ]),
    );
  });

  it('所有 datetime 欄位使用 precision 6 且 column name 為 snake_case', () => {
    const targets = new Set(tables.map(([target]) => target));
    const columns = storage.columns.filter((column) =>
      targets.has(column.target as (typeof tables)[number][0]),
    );
    for (const column of columns) {
      const name = String(column.options.name ?? column.propertyName);
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      if (column.options.type === 'datetime') {
        expect(column.options.precision).toBe(6);
      }
    }
  });
});
