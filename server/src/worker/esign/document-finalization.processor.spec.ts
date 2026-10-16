import type { Job } from 'bullmq';
import { DocumentFinalizationProcessor } from './document-finalization.processor';

describe('DocumentFinalizationProcessor', () => {
  const manager = {} as never;

  function setup(options?: {
    renderError?: Error;
    snapshotError?: Error;
    loseLease?: boolean;
    signerChangesAfterRender?: boolean;
  }) {
    const document = {
      id: 9,
      status: 'active',
      finalizationLeaseToken: undefined as string | undefined,
      finalizationLeaseExpiresAt: undefined as Date | undefined,
      completedAt: undefined as Date | undefined,
    };
    const signers = [
      {
        signerType: 'email',
        status: 'signed',
        completionReceiptSha256: 'receipt',
        completionReceiptExpiresAt: undefined as Date | undefined,
      },
    ];
    const mysql = {
      transaction: jest.fn((run: (value: never) => Promise<unknown>) =>
        run(manager),
      ),
    };
    const documents = {
      findByIdForUpdate: jest.fn(async () => document),
      save: jest.fn(async (value: object) => value),
    };
    const signerRepository = {
      findByDocumentForUpdate: jest.fn(async () => signers),
      saveMany: jest.fn(async (value: object[]) => value),
    };
    const stored = {
      objectKey: 'documents/x/completed/random.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      sha256: 'a'.repeat(64),
    };
    const completedPdf = {
      create: jest.fn(async () => {
        if (options?.renderError) throw options.renderError;
        if (options?.loseLease) document.finalizationLeaseToken = 'new-worker';
        if (options?.signerChangesAfterRender) signers[0].status = 'pending';
        return {
          stored,
          metadata: {
            mimeType: 'application/pdf',
            fileSize: 100,
            sha256: 'a'.repeat(64),
          },
        };
      }),
    };
    const files = {
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => value),
    };
    const audit = { append: jest.fn(async () => 'c'.repeat(64)) };
    const verification = {
      saveSnapshot: jest.fn(async () => {
        if (options?.snapshotError) throw options.snapshotError;
      }),
    };
    const storage = { delete: jest.fn(async () => undefined) };
    const processor = new DocumentFinalizationProcessor(
      mysql as never,
      documents as never,
      signerRepository as never,
      files as never,
      completedPdf as never,
      audit as never,
      verification as never,
      storage as never,
    );
    return {
      processor,
      document,
      signers,
      completedPdf,
      files,
      audit,
      verification,
      storage,
      stored,
    };
  }

  const job = { data: { documentId: 9 } } as Job<{ documentId: number }>;

  it('全員已簽後以 UUID/5 分鐘 lease claim，完成檔只提交一次', async () => {
    const { processor, document, signers, completedPdf, files, audit } = setup();
    await processor.process(job);

    expect(document.status).toBe('completed');
    expect(document.completedAt).toBeInstanceOf(Date);
    expect(document.finalizationLeaseToken).toBeUndefined();
    expect(files.save).toHaveBeenCalledTimes(1);
    expect(signers[0].completionReceiptExpiresAt!.getTime()).toBeGreaterThan(
      document.completedAt!.getTime(),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'document.completed' }),
      manager,
    );

    await processor.process(job);
    expect(completedPdf.create).toHaveBeenCalledTimes(1);
    expect(files.save).toHaveBeenCalledTimes(1);
  });

  it('同一 transaction 以 document.completed hash 寫入一筆驗證快照', async () => {
    const { processor, document, signers, verification, audit } = setup();
    await processor.process(job);

    expect(verification.saveSnapshot).toHaveBeenCalledTimes(1);
    expect(verification.saveSnapshot).toHaveBeenCalledWith(
      {
        document,
        signers,
        finalPdfSha256: 'a'.repeat(64),
        completedAt: document.completedAt,
        auditRootHash: 'c'.repeat(64),
      },
      manager,
    );
    expect(audit.append.mock.invocationCallOrder[0]).toBeLessThan(
      verification.saveSnapshot.mock.invocationCallOrder[0],
    );
  });

  it('驗證快照寫入失敗時結案失敗並清除完成檔，交由重試', async () => {
    const { processor, storage, stored } = setup({
      snapshotError: new Error('snapshot failed'),
    });
    await expect(processor.process(job)).rejects.toThrow('snapshot failed');
    expect(storage.delete).toHaveBeenCalledWith(stored);
  });

  it('舊 worker 失去 lease 後不得 commit，並清除自己產生的 orphan', async () => {
    const { processor, document, files, storage, stored, verification } = setup(
      { loseLease: true },
    );
    await processor.process(job);
    expect(document.status).toBe('finalizing');
    expect(files.save).not.toHaveBeenCalled();
    expect(verification.saveSnapshot).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith(stored);
  });

  it('第二次 transaction 重新確認全員已簽，狀態遭改動時不提交產物', async () => {
    const { processor, document, files, storage, stored } = setup({
      signerChangesAfterRender: true,
    });
    await processor.process(job);
    expect(document.status).toBe('finalizing');
    expect(files.save).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith(stored);
  });

  it('產檔失敗只由持有同一 lease 的 worker reset，保留簽署證據供重試', async () => {
    const { processor, document, audit, files } = setup({
      renderError: new Error('render failed'),
    });
    await expect(processor.process(job)).rejects.toThrow('render failed');
    expect(document.status).toBe('active');
    expect(document.finalizationLeaseToken).toBeUndefined();
    expect(files.save).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'document.finalization_failed' }),
      manager,
    );
  });

  it('空、亂序或尚未全簽的 job 都是 no-op', async () => {
    const { processor, completedPdf, signers } = setup();
    await processor.process({ data: { documentId: 0 } } as Job<{ documentId: number }>);
    signers[0].status = 'pending';
    await processor.process(job);
    expect(completedPdf.create).not.toHaveBeenCalled();
  });
});
