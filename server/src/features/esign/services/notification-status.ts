/** 聚合全部明細，不能用目前分頁推導整批結果。 */
export function notificationStatus(counts: Record<string, number>) {
  if (counts.processing) return 'processing';
  if (counts.pending) return 'queued';
  if (counts.unknown) return 'unknown';
  if (counts.failed) return counts.delivered ? 'partial_failed' : 'failed';
  return 'completed';
}
