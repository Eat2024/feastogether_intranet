import type { AuthMe } from '@/api/types';

export type IdentityBoundaryPhase =
  | 'initial-loading'
  | 'initial-paused'
  | 'initial-error'
  | 'revalidating'
  | 'revalidation-paused'
  | 'revalidation-error'
  | 'adopting'
  | 'ready';
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
  const hasAdoptedIdentity = input.adoptedIdentity !== null;
  if (input.fetchStatus === 'paused') {
    return hasAdoptedIdentity ? 'revalidation-paused' : 'initial-paused';
  }
  if (input.fetchStatus !== 'idle' || input.queryStatus === 'pending') {
    return hasAdoptedIdentity ? 'revalidating' : 'initial-loading';
  }
  if (input.queryStatus === 'error' || !input.hasData || !input.incomingIdentity) {
    return hasAdoptedIdentity && input.hasData && input.incomingIdentity === input.adoptedIdentity
      ? 'revalidation-error'
      : 'initial-error';
  }
  if (input.adoptedIdentity !== input.incomingIdentity) return 'adopting';
  return 'ready';
}

/** 同 actor 重驗保留 React subtree；初次載入及真正換 actor 才卸載。 */
export const keepsBusinessSubtreeMounted = (phase: IdentityBoundaryPhase): boolean =>
  phase === 'ready' || phase === 'revalidating' || phase.startsWith('revalidation-');

export function getEmptyNavigationPresentation(
  status: 'empty' | 'ready',
  sidebarOpen: boolean,
): EmptyNavigationPresentation {
  if (status !== 'empty') return 'none';
  return sidebarOpen ? 'expanded-message' : 'compact-tooltip';
}
