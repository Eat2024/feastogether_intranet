import { EsignAuditEvent } from '../entities/esign-audit-event.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { EsignViewMapper } from './esign-view.mapper';

describe('EsignViewMapper', () => {
  const mapper = new EsignViewMapper({
    verificationUrl: (code?: string) =>
      code ? `https://esign.example.internal/verify/${code}` : null,
  } as never);
  const signer = (status: 'pending' | 'signed') =>
    ({
      publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
      signerType: 'email',
      nameSnapshot: '外部簽署人',
      email: 'signer@example.test',
      status,
      signedAt: status === 'signed' ? new Date() : undefined,
    }) as EsignSigner;

  it('已簽署者以簽署紀錄的驗證代碼組出驗證網址', () => {
    expect(
      mapper.signer(signer('signed'), null, 'c'.repeat(22)).verificationUrl,
    ).toBe(`https://esign.example.internal/verify/${'c'.repeat(22)}`);
  });

  it('尚未簽署者沒有驗證代碼，verificationUrl 為 null', () => {
    expect(mapper.signer(signer('pending'), null).verificationUrl).toBeNull();
  });
});

describe('文件有效狀態', () => {
  const mapper = new EsignViewMapper({ verificationUrl: () => null } as never);
  it('截止當下仍有待簽者呈現已到期，並保留原始期限', () => {
    const document = Object.assign(new EsignDocument(), {
      id: 1,
      status: 'active',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      signEndAt: new Date('2026-10-19T00:00:00Z'),
      signingPayloadJson: { period: { endAt: '2026-10-19T00:00:00.000Z' } },
    });
    expect(
      mapper.documentSummary(
        document,
        { pendingCount: 1, signedCount: 1 },
        new Date('2026-10-19T00:00:00Z'),
      ),
    ).toMatchObject({
      status: 'expired',
      signEndAt: '2026-10-19T00:00:00.000Z',
      originalSignEndAt: '2026-10-19T00:00:00.000Z',
      isReopened: false,
    });
    expect(document.status).toBe('active');
    document.signEndAt = new Date('2026-10-20T00:00:00Z');
    expect(
      mapper.documentSummary(
        document,
        { pendingCount: 1, signedCount: 1 },
        new Date('2026-10-19T00:00:00Z'),
      ),
    ).toMatchObject({
      status: 'active',
      originalSignEndAt: '2026-10-19T00:00:00.000Z',
      signEndAt: '2026-10-20T00:00:00.000Z',
      isReopened: true,
    });
  });
});

describe('有效狀態邊界', () => {
  const mapper = new EsignViewMapper({ verificationUrl: () => null } as never);
  it.each([
    ['active', 1, '2026-10-19T00:00:00.001Z', 'active'],
    ['active', 1, '2026-10-18T23:59:59.999Z', 'expired'],
    ['active', 0, '2026-10-19T00:00:00.000Z', 'active'],
    ['active', 1, null, 'active'],
    ['finalizing', 1, '2026-10-19T00:00:00.000Z', 'finalizing'],
    ['completed', 1, '2026-10-19T00:00:00.000Z', 'completed'],
    ['stopped', 1, '2026-10-19T00:00:00.000Z', 'stopped'],
  ])(
    '%s、pending=%s、期限=%s 呈現 %s',
    (status, pendingCount, end, expected) => {
      const document = Object.assign(new EsignDocument(), {
        id: 1,
        status,
        createdAt: new Date(),
        signEndAt: end ? new Date(end) : undefined,
      });
      expect(
        mapper.documentSummary(
          document,
          { pendingCount: Number(pendingCount), signedCount: 0 },
          new Date('2026-10-19T00:00:00Z'),
        ).status,
      ).toBe(expected);
    },
  );
});

describe('歷程動作者身分與管理資料裁切', () => {
  const mapper = new EsignViewMapper({ verificationUrl: () => null } as never);
  const signer = Object.assign(new EsignSigner(), {
    id: 91,
    publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
    signerType: 'email',
    nameSnapshot: '外部甲',
    note: '不給本人看的管理資料',
  });
  it('本人動作使用姓名快照與穩定公開識別', () => {
    for (const eventType of [
      'signature.submitted',
      'signature.completed',
      'signer.rejected',
      'document.opened',
      'external_otp.verified',
    ]) {
      const event = Object.assign(new EsignAuditEvent(), {
        eventType,
        signerId: 91,
      });
      expect(mapper.historyActor(event, signer)).toEqual({
        kind: 'signer',
        name: '外部甲',
        signerPublicId: signer.publicId,
      });
    }
  });
  it('寄信與副本產製即使有 signerId 和 actorUserId 仍是系統；不洩漏管理備註', () => {
    for (const eventType of [
      'external_invitation.delivered',
      'external_otp.sent',
      'external_otp.locked',
      'signer.copy_completed',
      'signer.copy_failed',
      'document.completed',
    ]) {
      const event = Object.assign(new EsignAuditEvent(), {
        eventType,
        signerId: 91,
        actorUserId: 1,
      });
      expect(mapper.historyActor(event, signer)).toEqual({
        kind: 'system',
        name: '系統',
      });
    }
    expect(mapper.signer(signer, null)).not.toHaveProperty('note');
  });
});
