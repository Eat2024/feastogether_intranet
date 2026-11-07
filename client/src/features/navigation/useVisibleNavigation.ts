'use client';

import { getVisibleServices, type ServiceDefinition } from '@/components/sidebar/services';
import { usePermissionContext } from '@/providers/PermissionProvider';
import { useMemo } from 'react';

export type NavigationState =
  | { status: 'empty'; services: [] }
  | { status: 'ready'; services: ServiceDefinition[] };

/** auth/me 已由全域採用邊界確認；這裡只負責形成一致的可見服務清單。 */
export function useVisibleNavigation(): NavigationState {
  const { hasPermission } = usePermissionContext();
  const services = useMemo(() => getVisibleServices(hasPermission), [hasPermission]);
  return services.length === 0
    ? { status: 'empty', services: [] }
    : { status: 'ready', services };
}
