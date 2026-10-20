import {
  reminderEligibility,
  taipeiDispatchDate,
} from './esign-reminder-policy';

describe('外部催簽資格', () => {
  const document = {
    status: 'active',
    signStartAt: new Date('2026-10-20T00:00:00Z'),
    signEndAt: new Date('2026-10-25T00:00:00Z'),
  };
  const signer = {
    signerType: 'email',
    status: 'pending',
    invitationExpiresAt: document.signEndAt,
  };
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
      'DAILY_LIMIT',
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
    ).toBe('IN_FLIGHT');
    expect(
      reminderEligibility(
        document,
        signer,
        [{ ...delivered, result: 'pending' }],
        after,
      ),
    ).toBe('IN_FLIGHT');
    expect(
      reminderEligibility(
        document,
        signer,
        [{ ...delivered, batch: { kind: 'invitation' } }],
        before,
      ),
    ).toBeNull();
  });
  it('未知結果佔當日，拒簽、內部、期間外皆不可催簽', () => {
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
    ).toBe('DAILY_LIMIT');
    expect(
      reminderEligibility(document, { ...signer, signerType: 'user' }, [], now),
    ).toBe('INTERNAL_NOT_SUPPORTED');
    expect(
      reminderEligibility(document, { ...signer, status: 'rejected' }, [], now),
    ).toBe('SIGNER_NOT_PENDING');
    expect(
      reminderEligibility(
        document,
        signer,
        [],
        new Date('2026-10-19T00:00:00Z'),
      ),
    ).toBe('DOCUMENT_NOT_SIGNABLE');
  });
});
