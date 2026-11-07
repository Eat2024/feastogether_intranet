import type { AuthMe } from '@/api/types';

export type IdentityBoundaryPhase = 'loading' | 'paused' | 'error' | 'adopting' | 'ready';
export type EmptyNavigationPresentation = 'none' | 'expanded-message' | 'compact-tooltip';

export const getActorIdentity = (me: AuthMe): string =>
  me.user ? `employee:${me.actor.userId}` : `${me.actor.kind}:${me.actor.displayName}`;

/** 子樹只在目前快照已採用且沒有重新抓取時掛載，避免 A 的 query data 暴露給 B。 */
export function getIdentityBoundaryPhase(input: {
  queryStatus: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  hasData: boolean;
  adoptedIdentity: string | null;
  incomingIdentity: string | null;
}): IdentityBoundaryPhase {
  if (input.fetchStatus === 'paused') return 'paused';
  if (input.fetchStatus !== 'idle' || input.queryStatus === 'pending') return 'loading';
  if (input.queryStatus === 'error' || !input.hasData || !input.incomingIdentity) return 'error';
  if (input.adoptedIdentity !== input.incomingIdentity) return 'adopting';
  return 'ready';
}

export function getEmptyNavigationPresentation(
  status: 'empty' | 'ready',
  sidebarOpen: boolean,
): EmptyNavigationPresentation {
  if (status !== 'empty') return 'none';
  return sidebarOpen ? 'expanded-message' : 'compact-tooltip';
}
