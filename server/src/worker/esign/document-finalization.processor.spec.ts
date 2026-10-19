import type { Job } from 'bullmq';
import { canonicalSha256 } from '#app/features/esign/services/esign-audit.service';
import { DocumentFinalizationProcessor } from './document-finalization.processor';

describe('DocumentFinalizationProcessor 個人副本', () => {
  const manager = {} as never;
  const job = { data: { documentId: 9, signerId: 7 } } as Job<{
    documentId: number;
    signerId: number;
  }>;
  function setup() {
    const payload = { version: 2 };
    const payloadHash = canonicalSha256(payload);
    const document = {
      id: 9,
      status: 'finalizing',
      signingPayloadJson: payload,
      signingPayloadSha256: payloadHash,
      completedAt: undefined as Date | undefined,
    };
    const signer = {
      id: 7,
      documentId: 9,
      status: 'signed',
      completionStatus: 'pending',
      signedAt: new Date('2026-10-16T00:00:00Z'),
      completionLeaseToken: null as string | null,
      completionLeaseExpiresAt: null as Date | null,
      completionReadyAt: null as Date | null,
    };
    const record = {
      id: 21,
      signerId: 7,
      documentSha256: 'a'.repeat(64),
      signingPayloadSha256: payloadHash,
      signedAtUtc: signer.signedAt,
    };
    const mysql = {
      transaction: jest.fn(
        async (run: (manager: never) => Promise<unknown>) => {
          const beforeDocument = structuredClone(document),
            beforeSigner = structuredClone(signer);
          try {
            return await run(manager);
          } catch (error) {
            Object.assign(document, beforeDocument);
            Object.assign(signer, beforeSigner);
            throw error;
          }
        },
      ),
    };
    const documents = {
      findByIdForUpdate: jest.fn(async () => document),
      save: jest.fn(async (value: object) => value),
    };
    const signers = {
      findByIdForUpdate: jest.fn(async () => signer),
      findByDocument: jest.fn(async () => [signer]),
      completionCounts: jest.fn(async () => ({
        total: 1,
        pending: 0,
        ready: signer.completionStatus === 'ready' ? 1 : 0,
      })),
      save: jest.fn(async (value: object) => value),
    };
    const stored = {
      objectKey: 'personal.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      sha256: 'b'.repeat(64),
    };
    const output = {
      stored,
      metadata: stored,
      signatureRecordId: 21,
      sourceSha256: record.documentSha256,
      signingPayloadSha256: payloadHash,
    };
    const completedPdf = { create: jest.fn(async () => output) };
    const files = {
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => ({ id: 31, ...value })),
      findDocumentFile: jest.fn(async () => ({
        sha256: record.documentSha256,
      })),
    };
    const audit = { append: jest.fn(async () => 'c'.repeat(64)) };
    const verification = { saveSnapshot: jest.fn(async () => undefined) };
    const storage = { delete: jest.fn(async () => undefined) };
    const processor = new DocumentFinalizationProcessor(
      mysql as never,
      documents as never,
      signers as never,
      files as never,
      completedPdf as never,
      audit as never,
      verification as never,
      storage as never,
      { findBySignerId: jest.fn(async () => record) } as never,
    );
    return {
      processor,
      document,
      signer,
      signers,
      record,
      output,
      completedPdf,
      files,
      audit,
      verification,
      storage,
      stored,
    };
  }

  it('以 UUID 與五分鐘 lease 產製本人副本，全員 ready 後另行結案，重複工作不重製', async () => {
    const f = setup();
    f.completedPdf.create.mockImplementation(async () => {
      expect(f.signer.completionStatus).toBe('processing');
      expect(f.signer.completionLeaseToken).toMatch(/^[0-9a-f-]{36}$/);
      expect(
        f.signer.completionLeaseExpiresAt!.getTime() - Date.now(),
      ).toBeGreaterThan(290_000);
      return f.output;
    });
    await f.processor.process(job);
    expect(f.completedPdf.create).toHaveBeenCalledWith(9, 7);
    expect(f.signer).toMatchObject({
      completionStatus: 'ready',
      completionLeaseToken: null,
      completionLeaseExpiresAt: null,
      completionReadyAt: expect.any(Date),
    });
    expect(f.files.create.mock.calls[0][0]).toMatchObject({
      signatureRecordId: 21,
    });
    expect(f.files.create.mock.calls[0][0]).not.toHaveProperty('documentId');
    expect(f.document.status).toBe('completed');
    expect(f.verification.saveSnapshot).toHaveBeenCalledTimes(1);
    expect(f.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'signer.copy_completed',
        signerId: 7,
        metadata: {
          signatureRecordId: 21,
          completedFileId: 31,
          completedPdfSha256: 'b'.repeat(64),
        },
      }),
      manager,
    );
    await f.processor.process(job);
    expect(f.completedPdf.create).toHaveBeenCalledTimes(1);
  });

  it.each(['active', 'expired', 'stopped'])(
    '%s 文件仍產製已簽署者副本，不提前結案',
    async (status) => {
      const f = setup();
      f.document.status = status;
      await f.processor.process(job);
      expect(f.signer.completionStatus).toBe('ready');
      expect(f.document.status).toBe(status);
      expect(f.verification.saveSnapshot).not.toHaveBeenCalled();
    },
  );

  it('結案快照失敗保留 ready 副本，重試只補結案', async () => {
    const f = setup();
    f.verification.saveSnapshot.mockRejectedValueOnce(
      new Error('snapshot failed'),
    );
    await expect(f.processor.process(job)).rejects.toThrow('snapshot failed');
    expect(f.document.status).toBe('finalizing');
    expect(f.signer.completionStatus).toBe('ready');
    expect(f.storage.delete).not.toHaveBeenCalled();
    await f.processor.process(job);
    expect(f.document.status).toBe('completed');
    expect(f.completedPdf.create).toHaveBeenCalledTimes(1);
  });

  it('失去 lease 只能清自己的 orphan，不覆寫新 worker', async () => {
    const f = setup();
    f.completedPdf.create.mockImplementation(async () => {
      f.signer.completionLeaseToken = 'new-worker';
      return f.output;
    });
    await f.processor.process(job);
    expect(f.files.save).not.toHaveBeenCalled();
    expect(f.storage.delete).toHaveBeenCalledWith(f.stored);
    expect(f.signer.completionLeaseToken).toBe('new-worker');
  });

  it('產製失敗只更新本人 failed，簽署與文件狀態保留', async () => {
    const f = setup();
    f.completedPdf.create.mockRejectedValueOnce(new Error('render failed'));
    await expect(f.processor.process(job)).rejects.toThrow('render failed');
    expect(f.signer).toMatchObject({
      status: 'signed',
      completionStatus: 'failed',
      completionLeaseToken: null,
    });
    expect(f.document.status).toBe('finalizing');
    await f.processor.process(job);
    expect(f.signer.completionStatus).toBe('ready');
  });

  it('未到期 lease 不搶工作；到期後可重新 claim', async () => {
    const f = setup();
    f.signer.completionStatus = 'processing';
    f.signer.completionLeaseToken = 'old';
    f.signer.completionLeaseExpiresAt = new Date(Date.now() + 60_000);
    await f.processor.process(job);
    expect(f.completedPdf.create).not.toHaveBeenCalled();
    f.signer.completionLeaseExpiresAt = new Date(Date.now() - 1);
    await f.processor.process(job);
    expect(f.signer.completionStatus).toBe('ready');
  });

  it('舊 job 或跨文件 signer 不產製', async () => {
    const f = setup();
    await f.processor.process({ data: { documentId: 9 } } as typeof job);
    f.signer.documentId = 10;
    await f.processor.process(job);
    expect(f.completedPdf.create).not.toHaveBeenCalled();
  });

  it('產製後證據改動不得提交', async () => {
    const f = setup();
    f.completedPdf.create.mockImplementation(async () => {
      f.record.signingPayloadSha256 = 'tampered';
      return f.output;
    });
    await expect(f.processor.process(job)).rejects.toThrow('不一致');
    expect(f.files.save).not.toHaveBeenCalled();
    expect(f.storage.delete).toHaveBeenCalledWith(f.stored);
  });
});
