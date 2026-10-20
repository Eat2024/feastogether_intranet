/** 業務曆日僅用於催簽額度，持久化時間仍為 UTC。 */
export function taipeiDispatchDate(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

export interface ReminderHistory {
  id?: number;
  result: string;
  dispatchDate?: string | null;
  batch?: { kind: string };
}

export function reminderEligibility(
  document: {
    status: string;
    signStartAt?: Date | null;
    signEndAt?: Date | null;
    deletedAt?: Date | null;
  },
  signer: {
    signerType: string;
    status: string;
    invitationExpiresAt?: Date | null;
    deletedAt?: Date | null;
  },
  history: ReminderHistory[],
  now: Date,
): string | null {
  if (signer.signerType !== 'email') return 'INTERNAL_NOT_SUPPORTED';
  if (signer.status !== 'pending' || signer.deletedAt)
    return 'SIGNER_NOT_PENDING';
  if (
    document.deletedAt ||
    document.status !== 'active' ||
    !document.signStartAt ||
    !document.signEndAt ||
    now < document.signStartAt ||
    now >= document.signEndAt ||
    !signer.invitationExpiresAt ||
    now >= signer.invitationExpiresAt
  )
    return 'DOCUMENT_NOT_SIGNABLE';
  const reminders = history.filter((log) => log.batch?.kind === 'reminder');
  if (reminders.some((log) => ['pending', 'processing'].includes(log.result)))
    return 'IN_FLIGHT';
  if (
    reminders.some(
      (log) =>
        ['delivered', 'unknown'].includes(log.result) &&
        log.dispatchDate === taipeiDispatchDate(now),
    )
  )
    return 'DAILY_LIMIT';
  return null;
}
