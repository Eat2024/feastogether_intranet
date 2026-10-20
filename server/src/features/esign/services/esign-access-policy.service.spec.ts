import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';

describe('EsignAccessPolicyService', () => {
  const policy = new EsignAccessPolicyService(
    new EsignDocumentValidationService(),
    {} as never,
  );
  const now = new Date('2026-10-13T12:00:00.000Z');
  const document = () =>
    Object.assign(new EsignDocument(), {
      id: 1,
      createdByUserId: 10,
      status: 'active',
      signStartAt: new Date('2026-10-13T00:00:00.000Z'),
      signEndAt: new Date('2026-10-14T00:00:00.000Z'),
    });

  describe('checkAndLockDraftDoc', () => {
    const manager = {} as never;
    const setup = (found: EsignDocument | null) => {
      const documents = { findByIdForUpdate: jest.fn(async () => found) };
      const locking = new EsignAccessPolicyService(
        new EsignDocumentValidationService(),
        documents as never,
      );
      return { locking, documents };
    };
    const draft = () =>
      Object.assign(new EsignDocument(), {
        id: 1,
        createdByUserId: 10,
        status: 'draft',
      });

    it('在呼叫端交易內鎖定並回傳本人草稿', async () => {
      const doc = draft();
      const { locking, documents } = setup(doc);
      await expect(locking.checkAndLockDraftDoc(1, 10, manager)).resolves.toBe(
        doc,
      );
      expect(documents.findByIdForUpdate).toHaveBeenCalledWith(1, manager);
    });

    it.each([
      { name: '不存在', found: () => null, userId: 10 },
      { name: '非建立人', found: draft, userId: 11 },
    ])('$name 時回 404', async ({ found, userId }) => {
      const { locking } = setup(found());
      await expect(
        locking.checkAndLockDraftDoc(1, userId, manager),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('已發起的文件回 409', async () => {
      const { locking } = setup(Object.assign(draft(), { status: 'active' }));
      await expect(
        locking.checkAndLockDraftDoc(1, 10, manager),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it('creator 與 internal signer 越權統一為 404', () => {
    const doc = document();
    expect(() => policy.checkEsignCreator(doc, 10)).not.toThrow();
    expect(() => policy.checkEsignCreator(doc, 11)).toThrow('找不到電子簽資源');

    const signer = Object.assign(new EsignSigner(), {
      signerType: 'user',
      userId: 20,
      documentId: 1,
    });
    expect(() => policy.assertInternalSigner(doc, signer, 20)).not.toThrow();
    expect(() => policy.assertInternalSigner(doc, signer, 21)).toThrow(
      '找不到電子簽資源',
    );
  });

  it('完成 PDF 只允許 creator 或已簽署 internal signer', () => {
    const doc = document();
    const signer = Object.assign(new EsignSigner(), {
      signerType: 'user',
      userId: 20,
      documentId: 1,
      status: 'signed',
    });
    expect(() =>
      policy.assertCreatorOrSignedInternalSigner(doc, null, 10),
    ).not.toThrow();
    expect(() =>
      policy.assertCreatorOrSignedInternalSigner(doc, signer, 20),
    ).not.toThrow();
    signer.status = 'pending';
    expect(() =>
      policy.assertCreatorOrSignedInternalSigner(doc, signer, 20),
    ).toThrow('找不到電子簽資源');
  });

  it('external invitation 綁定 digest、pending、active 與期限，失敗統一 401', () => {
    const doc = document();
    const signer = Object.assign(new EsignSigner(), {
      signerType: 'email',
      documentId: 1,
      status: 'pending',
      invitationTokenSha256: 'a'.repeat(64),
      invitationExpiresAt: new Date('2026-10-14T00:00:00.000Z'),
    });
    expect(() =>
      policy.assertExternalInvitation(doc, signer, 'a'.repeat(64), now),
    ).not.toThrow();
    for (const digest of ['b'.repeat(64), 'short']) {
      expect(() =>
        policy.assertExternalInvitation(doc, signer, digest, now),
      ).toThrow('外部簽署存取已失效');
    }
    signer.status = 'signed';
    expect(() =>
      policy.assertExternalInvitation(doc, signer, 'a'.repeat(64), now),
    ).toThrow('外部簽署存取已失效');
  });

  describe('簽署期間尚未開始', () => {
    const startAt = new Date('2026-10-14T16:00:00.000Z');
    const pendingSigner = () =>
      Object.assign(new EsignSigner(), {
        signerType: 'email',
        documentId: 1,
        status: 'pending',
        invitationTokenSha256: 'a'.repeat(64),
        invitationExpiresAt: new Date('2026-10-20T00:00:00.000Z'),
      });
    const futureDocument = () =>
      Object.assign(document(), {
        signStartAt: startAt,
        signEndAt: new Date('2026-10-20T00:00:00.000Z'),
      });

    it('有效憑證的待簽者在開始前收到尚未開始錯誤，以台北時間告知開始時間', () => {
      expect(() =>
        policy.assertExternalInvitation(
          futureDocument(),
          pendingSigner(),
          'a'.repeat(64),
          new Date(startAt.getTime() - 1),
        ),
      ).toThrow('簽署尚未開始，請於 2026/10/15 00:00（台北時間）後簽署');
    });

    it.each([
      ['開始當下', startAt],
      ['期間內', new Date('2026-10-17T00:00:00.000Z')],
    ])('%s可以存取', (_name, at) => {
      expect(() =>
        policy.assertExternalInvitation(
          futureDocument(),
          pendingSigner(),
          'a'.repeat(64),
          at,
        ),
      ).not.toThrow();
    });

    it.each([
      {
        name: '期間結束後',
        doc: futureDocument,
        digest: 'a'.repeat(64),
        at: new Date('2026-10-20T00:00:00.000Z'),
      },
      {
        name: '憑證不符',
        doc: futureDocument,
        digest: 'b'.repeat(64),
        at: new Date('2026-10-14T00:00:00.000Z'),
      },
      {
        name: '文件已停止',
        doc: () => Object.assign(futureDocument(), { status: 'stopped' }),
        digest: 'a'.repeat(64),
        at: new Date('2026-10-14T00:00:00.000Z'),
      },
    ])('$name時一律回通用失效，不揭露開始時間', ({ doc, digest, at }) => {
      expect(() =>
        policy.assertExternalInvitation(doc(), pendingSigner(), digest, at),
      ).toThrow('外部簽署存取已失效');
    });
  });
});
