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

describe('歷程中文顯示', () => {
  const mapper = new EsignViewMapper({ verificationUrl: () => null } as never);
  it.each([
    ['consent.accepted', '簽署人同意電子簽名條款'],
    ['document.completed', '所有簽署人皆已完成簽署或拒簽'],
    ['document.created', '建立草稿'],
    ['document.draft_deleted', '刪除草稿'],
    ['document.draft_updated', '更新草稿'],
    ['document.expired', '簽署期限已到，文件已到期'],
    ['document.initiated', '發起簽署'],
    ['document.opened', '簽署人開啟文件'],
    ['document.reopened', '建立人設定補簽，重新開放未簽署者簽署'],
    ['document.stopped_by_creator', '建立人停止簽署'],
    ['document.stopped_by_deadline', '簽署期限已到，系統自動停止'],
    ['external_invitation.delivered', '外部簽署人邀請信已寄送'],
    ['external_invitation.opened', '外部簽署人開啟邀請連結'],
    ['external_otp.failed', '外部簽署人輸入的驗證碼錯誤'],
    ['external_otp.locked', '外部簽署人驗證碼錯誤次數已滿，驗證碼失效'],
    ['external_otp.sent', '寄送驗證碼給外部簽署人'],
    ['external_otp.verified', '外部簽署人通過驗證碼'],
    ['external_reminder.delivered', '外部簽署人催簽信已寄送'],
    ['internal_invitation.delivered', '已寄出內部簽署邀請通知'],
    ['internal_notification.protocol_error', '內部通知寄送結果異常'],
    ['internal_reminder.delivered', '已寄出內部催簽通知'],
    ['signature.completed', '簽署人完成簽署'],
    ['signature.submitted', '簽署人送出簽名'],
    ['signer.assigned', '指派簽署人'],
    ['signer.copy_completed', '個人簽署副本產生完成'],
    ['signer.copy_failed', '個人簽署副本產生失敗'],
    ['signer.rejected', '簽署人拒絕簽署'],
    ['legacy.unknown', '其他簽署歷程事件'],
    ['constructor', '其他簽署歷程事件'],
  ])('%s 顯示 %s', (type, label) => {
    expect(mapper.historyLabel(type)).toBe(label);
  });
});
