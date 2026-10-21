import {
  reminderEligibility,
  taipeiDispatchDate,
} from './esign-reminder-policy';

describe('內外部催簽資格', () => {
  const document = {
    status: 'active',
    signStartAt: new Date('2026-10-20T00:00:00Z'),
    signEndAt: new Date('2026-10-25T00:00:00Z'),
  };
  const signer = {
    signerType: 'email',
    email: 'fixed@example.test',
    invitationTokenSha256: 'a'.repeat(64),
    status: 'pending',
    invitationExpiresAt: document.signEndAt,
  };
  it.each([null, '', 'invalid-address'])(
    '固定信箱 %s 不可用時不得催簽',
    (email) => {
      expect(
        reminderEligibility(
          document,
          { ...signer, signerType: 'user', email },
          [],
          new Date('2026-10-20T12:00:00Z'),
        ),
      ).toBe('RECIPIENT_UNAVAILABLE');
    },
  );
  it('缺邀請世代的歷史員工不可催簽', () => {
    expect(
      reminderEligibility(
        document,
        { ...signer, signerType: 'user', invitationTokenSha256: null },
        [],
        new Date('2026-10-20T12:00:00Z'),
      ),
    ).toBe('RECIPIENT_UNAVAILABLE');
  });
  it('台北午夜重置，跨日排隊仍阻擋；初邀不佔額度', () => {
    const before = new Date('2026-10-20T15:59:59Z');
    const after = new Date('2026-10-20T16:00:00Z');
    expect(taipeiDispatchDate(before)).toBe('2026-10-20');
    expect(taipeiDispatchDate(after)).toBe('2026-10-21');
    const delivered = {
      result: 'delivered',
      dispatchDate: '2026-10-20',
      batch: { kind: 'reminder' },
    };
    expect(reminderEligibility(document, signer, [delivered], before)).toBe(
      'REMINDER_DAILY_LIMIT',
    );
    expect(
      reminderEligibility(document, signer, [delivered], after),
    ).toBeNull();
    expect(
      reminderEligibility(
        document,
        signer,
        [{ ...delivered, result: 'processing' }],
        after,
      ),
    ).toBe('REMINDER_IN_PROGRESS');
    expect(
      reminderEligibility(
        document,
        signer,
        [{ ...delivered, result: 'pending' }],
        after,
      ),
    ).toBe('REMINDER_IN_PROGRESS');
    expect(
      reminderEligibility(
        document,
        signer,
        [{ ...delivered, batch: { kind: 'invitation' } }],
        before,
      ),
    ).toBeNull();
  });
  it('已排定的明確失敗重試跨午夜仍佔用原明細；重試終止後才能再申請', () => {
    const retry = {
      result: 'failed',
      nextAttemptAt: new Date('2026-10-20T16:05:00Z'),
      batch: { kind: 'reminder' },
    };
    expect(
      reminderEligibility(
        document,
        signer,
        [retry],
        new Date('2026-10-20T16:00:00Z'),
      ),
    ).toBe('REMINDER_IN_PROGRESS');
    expect(
      reminderEligibility(
        document,
        signer,
        [{ ...retry, nextAttemptAt: null }],
        new Date('2026-10-20T16:00:00Z'),
      ),
    ).toBeNull();
  });
  it('未知結果佔當日，內部可催簽，拒簽與期間外不可催簽', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(
      reminderEligibility(
        document,
        signer,
        [
          {
            result: 'unknown',
            dispatchDate: '2026-10-20',
            batch: { kind: 'reminder' },
          },
        ],
        now,
      ),
    ).toBe('REMINDER_DAILY_LIMIT');
    expect(
      reminderEligibility(document, { ...signer, signerType: 'user' }, [], now),
    ).toBeNull();
    expect(
      reminderEligibility(document, { ...signer, status: 'rejected' }, [], now),
    ).toBe('SIGNER_ALREADY_COMPLETED');
    expect(
      reminderEligibility(
        document,
        signer,
        [],
        new Date('2026-10-19T00:00:00Z'),
      ),
    ).toBe('SIGNING_WINDOW_CLOSED');
  });
});
