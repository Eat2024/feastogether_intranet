'use client';

import { useGetMeQuery } from '@/api/queries';
import type { AuthMe } from '@/api/types';
import { getVisibleServices, type ServiceDefinition } from '@/components/sidebar/services';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { clearInternalBusinessCache } from './authorization-cache';

export type NavigationState =
  | { status: 'loading'; services: [] }
  | { status: 'error'; services: []; offline: boolean; retry: () => void; retrying: boolean }
  | { status: 'empty'; services: [] }
  | { status: 'ready'; services: ServiceDefinition[]; me: AuthMe };

const actorIdentity = (me: AuthMe): string =>
  me.user ? `employee:${me.actor.userId}` : `${me.actor.kind}:${me.actor.displayName}`;

/** 只有目前 route 的 auth/me 查詢成功且 idle 才提供 links，重驗期間不沿用舊能力。 */
export function useVisibleNavigation(pathname: string): NavigationState {
  const queryClient = useQueryClient();
  const query = useGetMeQuery(pathname);
  const [acceptedIdentity, setAcceptedIdentity] = useState<string | null>(null);
  const identity = query.data ? actorIdentity(query.data) : null;
  const switchingIdentity = acceptedIdentity !== null && identity !== null && acceptedIdentity !== identity;

  useEffect(() => {
    if (!identity || identity === acceptedIdentity) return;
    let active = true;
    if (acceptedIdentity === null) {
      queueMicrotask(() => {
        if (active) setAcceptedIdentity(identity);
      });
      return () => { active = false; };
    }
    void clearInternalBusinessCache(queryClient).then(() => {
      if (active) setAcceptedIdentity(identity);
    });
    return () => { active = false; };
  }, [acceptedIdentity, identity, queryClient]);

  const services = useMemo(
    () => query.data ? getVisibleServices(query.data.modules) : [],
    [query.data],
  );

  if (query.fetchStatus === 'paused') {
    return {
      status: 'error', services: [], offline: true,
      retry: () => { void query.refetch(); }, retrying: false,
    };
  }
  if (query.fetchStatus !== 'idle' || switchingIdentity || query.isPending) {
    return { status: 'loading', services: [] };
  }
  if (query.isError || !query.data) {
    return {
      status: 'error',
      services: [],
      offline: !globalThis.navigator?.onLine,
      retry: () => { void query.refetch(); },
      retrying: query.isFetching,
    };
  }
  if (services.length === 0) return { status: 'empty', services: [] };
  return { status: 'ready', services, me: query.data };
}
