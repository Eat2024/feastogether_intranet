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
import {
  getActorIdentity,
  getIdentityBoundaryPhase,
  keepsBusinessSubtreeMounted,
} from './identity-adoption';

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
  overlay = false,
}: {
  error?: boolean;
  offline?: boolean;
  retry?: () => void;
  retrying?: boolean;
  overlay?: boolean;
}) {
  return (
    <Box
      sx={{
        minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3,
        ...(overlay && {
          position: 'fixed', inset: 0, zIndex: 'modal', bgcolor: 'background.default',
        }),
      }}
    >
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
  const [adopted, setAdopted] = useState<{ identity: string; me: AuthMe } | null>(null);
  const adoptedIdentity = adopted?.identity ?? null;
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
      if (!query.data) return;
      if (adoptedIdentity === null) await Promise.resolve();
      else await clearInternalBusinessCache(queryClient);
      if (active) setAdopted({ identity: incomingIdentity, me: query.data });
    };
    void adopt();
    return () => { active = false; };
  }, [adoptedIdentity, incomingIdentity, phase, query.data, queryClient]);

  if (phase === 'initial-paused') {
    return <BoundaryStatus error offline retry={() => { void query.refetch(); }} />;
  }
  if (phase === 'initial-error') {
    return (
      <BoundaryStatus
        error
        offline={typeof navigator !== 'undefined' && !navigator.onLine}
        retry={() => { void query.refetch(); }}
        retrying={query.isFetching}
      />
    );
  }
  if (!keepsBusinessSubtreeMounted(phase)) return <BoundaryStatus />;

  const blocked = phase !== 'ready';
  const contextValue = blocked ? adopted?.me : query.data;
  if (!contextValue) return <BoundaryStatus />;

  return (
    <CurrentAuthMeContext.Provider value={contextValue}>
      <Box
        inert={blocked || undefined}
        aria-hidden={blocked || undefined}
        sx={blocked ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
      >
        {children}
      </Box>
      {phase === 'revalidating' && <BoundaryStatus overlay />}
      {phase === 'revalidation-paused' && (
        <BoundaryStatus overlay error offline retry={() => { void query.refetch(); }} />
      )}
      {phase === 'revalidation-error' && (
        <BoundaryStatus
          overlay
          error
          offline={typeof navigator !== 'undefined' && !navigator.onLine}
          retry={() => { void query.refetch(); }}
          retrying={query.isFetching}
        />
      )}
    </CurrentAuthMeContext.Provider>
  );
}
