'use client';

import { useCurrentAuthMe } from '@/features/navigation/InternalIdentityBoundary';
import {
  hasPermission as checkPermission,
  type HasPermission,
} from '@/features/navigation/has-permission';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

type PermissionContextValue = { hasPermission: HasPermission };

const PermissionContext = createContext<PermissionContextValue | null>(null);

/** 將已安全採用的 auth/me 能力快照收斂成與驗收系統一致的 hasPermission 介面。 */
export default function PermissionProvider({ children }: { children: ReactNode }) {
  const me = useCurrentAuthMe();
  const hasPermission = useCallback<HasPermission>(
    (moduleKey, ...permissions) => checkPermission(me.modules, moduleKey, ...permissions),
    [me.modules],
  );
  const value = useMemo(() => ({ hasPermission }), [hasPermission]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissionContext(): PermissionContextValue {
  const value = useContext(PermissionContext);
  if (!value) throw new Error('usePermissionContext 必須在 PermissionProvider 內使用');
  return value;
}
