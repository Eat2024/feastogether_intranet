'use client';

import { useGetMeQuery } from '@/api/queries';
import type { AuthMe } from '@/api/types';
import { useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearInternalBusinessCache } from './authorization-cache';
import { getActorIdentity, getIdentityBoundaryPhase } from './identity-adoption';

const CurrentAuthMeContext = createContext<AuthMe | null>(null);

export function useCurrentAuthMe(): AuthMe {
  const value = useContext(CurrentAuthMeContext);
  if (!value) throw new Error('InternalIdentityBoundary is missing');
  return value;
}

function BoundaryStatus({
  error,
  offline = false,
  retry,
  retrying = false,
}: {
  error?: boolean;
  offline?: boolean;
  retry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
      {error ? (
        <Alert
          severity="error"
          action={retry && (
            <Button color="inherit" onClick={retry} loading={retrying}>重新取得</Button>
          )}
        >
          {offline ? '目前離線，重新連線後再試' : '無法取得功能權限，請重試'}
        </Alert>
      ) : (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }} role="status">
          <CircularProgress size={22} />
          <Typography variant="description">載入可用功能中…</Typography>
        </Stack>
      )}
    </Box>
  );
}

/** auth/me 的全域採用邊界；清完上一個 actor 的內部快取前不掛載任何業務子樹。 */
export default function InternalIdentityBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const query = useGetMeQuery(pathname);
  const [adoptedIdentity, setAdoptedIdentity] = useState<string | null>(null);
  const incomingIdentity = query.data ? getActorIdentity(query.data) : null;
  const phase = getIdentityBoundaryPhase({
    queryStatus: query.status,
    fetchStatus: query.fetchStatus,
    hasData: !!query.data,
    adoptedIdentity,
    incomingIdentity,
  });

  useEffect(() => {
    if (phase !== 'adopting' || !incomingIdentity) return;
    let active = true;
    const adopt = async () => {
      if (adoptedIdentity === null) await Promise.resolve();
      else await clearInternalBusinessCache(queryClient);
      if (active) setAdoptedIdentity(incomingIdentity);
    };
    void adopt();
    return () => { active = false; };
  }, [adoptedIdentity, incomingIdentity, phase, queryClient]);

  if (phase === 'paused') {
    return <BoundaryStatus error offline retry={() => { void query.refetch(); }} />;
  }
  if (phase === 'error') {
    return (
      <BoundaryStatus
        error
        offline={typeof navigator !== 'undefined' && !navigator.onLine}
        retry={() => { void query.refetch(); }}
        retrying={query.isFetching}
      />
    );
  }
  if (phase !== 'ready' || !query.data) return <BoundaryStatus />;

  return <CurrentAuthMeContext.Provider value={query.data}>{children}</CurrentAuthMeContext.Provider>;
}
