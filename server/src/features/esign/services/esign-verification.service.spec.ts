import { createHash } from 'node:crypto';
import {
  auditEventHash,
  canonicalJson,
  canonicalSha256,
} from './esign-audit.service';
import {
  EsignVerificationService,
  VERIFICATION_MANIFEST_SCHEMA,
} from './esign-verification.service';

const signerPublicId = 'c854d925-1d70-49dc-9c81-abf18409ae42';
const otherPublicId = '7f0f9a8e-2a43-4d55-9d41-6d2b2a0c1e11';
const signedAt = new Date('2026-10-16T07:30:00.000Z');
const completedAt = new Date('2026-10-16T08:00:00.000Z');
const stoppedAt = new Date('2026-10-16T09:00:00.000Z');
const sha = (char: string) => char.repeat(64);
const verificationCode = 'Xy3_kLm9-QwErTyUiOpAsD';

/** 依寫入規則建立一條合法稽核鏈；metadata 為 null 模擬 DB 讀回的空 JSON。 */
function auditChain(eventTypes: string[]) {
  let previous: string | undefined;
  return eventTypes.map((eventType, index) => {
    const event = {
      id: index + 1,
      documentId: 4,
      signerId: index === 1 ? 8 : index === 2 ? 9 : null,
      actorUserId: null,
      eventType,
      occurredAt: new Date(signedAt.getTime() + index * 1000),
      requestId: null,
      metadataJson:
        eventType === 'signer.copy_completed'
          ? {
              signatureRecordId: index + 20,
              completedFileId: index + 30,
              completedPdfSha256: index === 1 ? sha('f') : sha('e'),
            }
          : null,
      previousEventHash: previous ?? null,
      eventHash: '',
    };
    event.eventHash = auditEventHash(previous, {
      ...event,
      metadata: event.metadataJson,
    });
    previous = event.eventHash;
    return event;
  });
}

function setup(
  status: 'active' | 'finalizing' | 'completed' | 'stopped' = 'completed',
) {
  const signer = {
    id: 8,
    publicId: signerPublicId,
    documentId: 4,
    status: 'signed',
    completionStatus: 'ready',
    nameSnapshot: '王小明',
    empidSnapshot: 'E0001',
    email: 'signer@example.test',
    departmentSnapshot: '測試部',
    signedAt,
  };
  const other = {
    id: 9,
    publicId: otherPublicId,
    documentId: 4,
    status: 'signed',
    completionStatus: 'ready',
    nameSnapshot: '另一位',
    signedAt: new Date(signedAt.getTime() + 60_000),
  };
  const record = {
    id: 21,
    signerId: 8,
    verificationCode,
    signedAtUtc: signedAt,
    authenticationMethod: 'employee_session',
    consentVersion: 'esign-consent-v1',
    documentSha256: sha('a'),
    signingPayloadSha256: canonicalSha256({ schemaVersion: 2 }),
    sourceIp: '203.0.113.9',
    userAgent: 'secret-agent',
  };
  const otherRecord = {
    ...record,
    id: 22,
    signerId: 9,
    signedAtUtc: other.signedAt,
    authenticationMethod: 'email_invitation',
  };
  const document = {
    id: 4,
    docNumber: '550e8400-e29b-41d4-a716-446655440000',
    title: '測試文件',
    status,
    signingPayloadJson: { schemaVersion: 2 },
    signingPayloadSha256: canonicalSha256({ schemaVersion: 2 }),
    completedAt: status === 'completed' ? completedAt : undefined,
    stoppedAt: status === 'stopped' ? stoppedAt : undefined,
  };
  const events = auditChain([
    'document.created',
    'signer.copy_completed',
    'signer.copy_completed',
    'document.completed',
  ]);
  const files = {
    source: { sha256: sha('a') },
    completed: {
      id: 31,
      signatureRecordId: 21,
      filePurpose: 'completed_pdf',
      archiveStatus: 'active',
      sha256: sha('f'),
    },
    other: {
      id: 32,
      signatureRecordId: 22,
      filePurpose: 'completed_pdf',
      archiveStatus: 'active',
      sha256: sha('e'),
    },
  };
  const state: { snapshot: Record<string, any> | null } = { snapshot: null };
  const repositories = {
    documents: { findById: jest.fn(async () => document) },
    signers: { findById: jest.fn(async () => signer) },
    records: {
      // 刻意反序，確認 manifest 依簽署人順序而非紀錄順序
      findBySignerIds: jest.fn(async () => [otherRecord, record]),
      findByVerificationCode: jest.fn(async (code: string) =>
        code === verificationCode ? record : null,
      ),
    },
    files: {
      findCompletedFile: jest.fn(async () => files.completed),
      findCompletedFiles: jest.fn(async () => [files.other, files.completed]),
      findDocumentFile: jest.fn(async (_id: number, purpose: string) =>
        purpose === 'source_pdf' ? files.source : files.completed,
      ),
    },
    audits: { findDocumentEvents: jest.fn(async () => events) },
    snapshots: {
      insert: jest.fn(async (row: Record<string, any>) => {
        state.snapshot = row;
      }),
      findByDocumentId: jest.fn(async () => state.snapshot),
    },
  };
  const tokens = {
    isVerificationCodeFormat: jest.fn((code: string) => code.length === 22),
  };
  const logger = { warn: jest.fn() };
  const service = new EsignVerificationService(
    { getManager: () => ({}) } as never,
    repositories.documents as never,
    repositories.signers as never,
    repositories.records as never,
    repositories.files as never,
    repositories.audits as never,
    repositories.snapshots as never,
    tokens as never,
    logger as never,
  );
  const saveSnapshot = () =>
    service.saveSnapshot(
      {
        document: document as never,
        signers: [signer, other] as never,
        completedAt,
        auditRootHash: events[3].eventHash,
      },
      {} as never,
    );
  return {
    service,
    signer,
    record,
    document,
    events,
    files,
    state,
    repositories,
    logger,
    saveSnapshot,
  };
}

describe('EsignVerificationService.saveSnapshot', () => {
  it('依 canonical manifest 寫入一筆快照，signers 依簽署人順序且不含個資', async () => {
    const { state, saveSnapshot, events } = setup();
    await saveSnapshot();
    const snapshot = state.snapshot!;

    expect(snapshot).toMatchObject({
      documentId: 4,
      finalPdfSha256: null,
      auditRootHash: events[3].eventHash,
      status: 'valid',
      issuedAt: completedAt,
    });
    expect(snapshot.publicId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(snapshot.revokedAt).toBeUndefined();
    expect(snapshot.manifestJson).toEqual({
      schemaVersion: VERIFICATION_MANIFEST_SCHEMA,
      document: {
        docNumber: '550e8400-e29b-41d4-a716-446655440000',
        sourcePdfSha256: sha('a'),
        signingPayloadSha256: canonicalSha256({ schemaVersion: 2 }),
        completedAt: completedAt.toISOString(),
      },
      signers: [
        expect.objectContaining({
          signerPublicId,
          signatureRecordId: 21,
          completedFileId: 31,
          completedPdfSha256: sha('f'),
          copyCompletedEventHash: events[1].eventHash,
        }),
        expect.objectContaining({ signerPublicId: otherPublicId }),
      ],
      auditRootHash: events[3].eventHash,
    });
    expect(snapshot.manifestSha256).toBe(
      createHash('sha256')
        .update(canonicalJson(snapshot.manifestJson), 'utf8')
        .digest('hex'),
    );
    expect(JSON.stringify(snapshot.manifestJson)).not.toMatch(
      /王小明|另一位|signer@example|E0001|測試部|203\.0\.113|secret-agent/,
    );
  });

  it('缺原始 PDF 或任何簽署紀錄時拋錯讓結案 rollback，不記成公開驗證告警', async () => {
    const { repositories, saveSnapshot, logger } = setup();
    repositories.records.findBySignerIds.mockResolvedValueOnce([]);
    await expect(saveSnapshot()).rejects.toThrow('文件完整性驗證失敗');
    repositories.files.findDocumentFile.mockResolvedValueOnce(null as never);
    await expect(saveSnapshot()).rejects.toThrow('文件完整性驗證失敗');
    expect(repositories.snapshots.insert).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('EsignVerificationService.verify', () => {
  it('完成文件回傳白名單欄位與完成文件摘要', async () => {
    const { service, saveSnapshot } = setup();
    await saveSnapshot();
    const result = await service.verify(verificationCode);

    expect(result).toEqual({
      signature: {
        signerName: '王小明',
        signedAt: signedAt.toISOString(),
        authenticationMethod: 'employee_session',
      },
      document: {
        title: '測試文件',
        status: 'completed',
        signedSourceSha256: sha('a'),
        completedAt: completedAt.toISOString(),
        stoppedAt: null,
        completedPdfSha256: sha('f'),
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /signer@example|E0001|測試部|203\.0\.113|secret-agent|另一位|signerPublicId/,
    );
  });

  it.each(['active', 'finalizing', 'stopped'] as const)(
    '%s 文件回簽章有效、不查快照且 completedPdfSha256 為 null',
    async (status) => {
      const { service, repositories } = setup(status);
      const result = await service.verify(verificationCode);
      expect(result.document).toMatchObject({
        status,
        completedAt: null,
        stoppedAt: status === 'stopped' ? stoppedAt.toISOString() : null,
        completedPdfSha256: null,
      });
      expect(repositories.snapshots.findByDocumentId).not.toHaveBeenCalled();
    },
  );

  it('代碼格式不符時不查 DB，回通用 404', async () => {
    const { service, repositories } = setup();
    await expect(service.verify('malformed')).rejects.toMatchObject({
      status: 404,
      message: '查無此簽章或驗證碼無效',
    });
    expect(repositories.records.findByVerificationCode).not.toHaveBeenCalled();
  });

  it.each([
    [
      '查無此代碼',
      (ctx: ReturnType<typeof setup>) => {
        ctx.repositories.records.findByVerificationCode.mockResolvedValue(
          null as never,
        );
      },
    ],
    [
      '簽署人已刪除',
      (ctx: ReturnType<typeof setup>) => {
        ctx.repositories.signers.findById.mockResolvedValue(null as never);
      },
    ],
    [
      '尚未簽署',
      (ctx: ReturnType<typeof setup>) => {
        ctx.signer.status = 'pending';
      },
    ],
    [
      '文件為草稿',
      (ctx: ReturnType<typeof setup>) => {
        (ctx.document as { status: string }).status = 'draft';
      },
    ],
    [
      '文件已刪除',
      (ctx: ReturnType<typeof setup>) => {
        ctx.repositories.documents.findById.mockResolvedValue(null as never);
      },
    ],
  ])('%s時回同一個 404', async (_name, arrange) => {
    const ctx = setup('active');
    arrange(ctx);
    await expect(ctx.service.verify(verificationCode)).rejects.toMatchObject({
      status: 404,
      message: '查無此簽章或驗證碼無效',
    });
  });

  it.each([
    [
      '缺驗證快照',
      (ctx: ReturnType<typeof setup>) => {
        ctx.state.snapshot = null;
      },
    ],
    [
      'manifest hash 不符',
      (ctx: ReturnType<typeof setup>) => {
        ctx.state.snapshot!.manifestSha256 = sha('0');
      },
    ],
    [
      '完成 PDF 摘要不符',
      (ctx: ReturnType<typeof setup>) => {
        ctx.files.completed.sha256 = sha('0');
      },
    ],
    [
      '本人快照項目不符',
      (ctx: ReturnType<typeof setup>) => {
        const manifest = ctx.state.snapshot!.manifestJson;
        manifest.signers[0].documentSha256 = sha('c');
        ctx.state.snapshot!.manifestSha256 = canonicalSha256(manifest);
      },
    ],
    [
      'manifest 形狀遭竄改',
      (ctx: ReturnType<typeof setup>) => {
        const manifest = { ...ctx.state.snapshot!.manifestJson, signers: 'x' };
        ctx.state.snapshot!.manifestJson = manifest;
        ctx.state.snapshot!.manifestSha256 = canonicalSha256(manifest);
      },
    ],
    [
      '稽核鏈遭竄改',
      (ctx: ReturnType<typeof setup>) => {
        ctx.events[1].eventType = 'tampered';
      },
    ],
    [
      '稽核鏈終點不是 document.completed',
      (ctx: ReturnType<typeof setup>) => {
        const snapshot = ctx.state.snapshot!;
        snapshot.auditRootHash = ctx.events[1].eventHash;
        snapshot.manifestJson.auditRootHash = ctx.events[1].eventHash;
        snapshot.manifestSha256 = canonicalSha256(snapshot.manifestJson);
      },
    ],
    [
      '快照已撤銷',
      (ctx: ReturnType<typeof setup>) => {
        ctx.state.snapshot!.status = 'revoked';
      },
    ],
    [
      '文件完成時間與快照不符',
      (ctx: ReturnType<typeof setup>) => {
        (ctx.document as { completedAt?: Date }).completedAt = new Date(0);
      },
    ],
  ])('完成文件%s時回 409', async (_name, arrange) => {
    const ctx = setup();
    await ctx.saveSnapshot();
    arrange(ctx);
    await expectIntegrityFailure(ctx);
  });

  it.each([
    [
      '簽署人與簽署紀錄時間不一致',
      (ctx: ReturnType<typeof setup>) => {
        ctx.signer.signedAt = new Date(0);
      },
    ],
    [
      '簽署紀錄的原始 PDF 摘要與文件不符',
      (ctx: ReturnType<typeof setup>) => {
        ctx.files.source.sha256 = sha('9');
      },
    ],
    [
      '簽署紀錄的簽署參數摘要與文件不符',
      (ctx: ReturnType<typeof setup>) => {
        ctx.document.signingPayloadSha256 = sha('9');
      },
    ],
  ])('進行中文件%s時回 409', async (_name, arrange) => {
    const ctx = setup('active');
    arrange(ctx);
    await expectIntegrityFailure(ctx);
  });
});

/** 409 且記錄不含 token、只含 documentId 的告警。 */
async function expectIntegrityFailure(ctx: ReturnType<typeof setup>) {
  await expect(ctx.service.verify(verificationCode)).rejects.toMatchObject({
    status: 409,
  });
  expect(ctx.logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'esign.verification_integrity_failed',
      metadata: { documentId: 4 },
    }),
  );
  expect(JSON.stringify(ctx.logger.warn.mock.calls)).not.toContain(
    verificationCode,
  );
}
