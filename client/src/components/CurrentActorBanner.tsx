'use client';

// 員工頁共用版面上的目前身分：沒有員工資料的身分（員工以外）才顯示 server 給的名稱（員工畫面不變），並提供登出。
// 登出後整頁 replace 到根路徑：清掉舊會話的 query 快取；沒有會話時 proxy 會回 404。
import { useGetMeQuery } from '@/api/queries';
import { deleteSession } from '@/api/requests';
import { clearInternalIdentityCache } from '@/features/navigation/authorization-cache';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';

export default function CurrentActorBanner() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data: session } = useGetMeQuery(pathname);
  const logout = useMutation({
    mutationFn: deleteSession,
    onSuccess: async () => {
      await clearInternalIdentityCache(queryClient);
      window.location.replace('/');
    },
  });

  if (!session || session.user) return null;
  return (
    <Alert
      severity="info"
      action={
        <Button
          color="inherit"
          size="small"
          disabled={logout.isPending || logout.isSuccess}
          onClick={() => logout.mutate()}
        >
          登出
        </Button>
      }
    >
      目前身分：{session.actor.displayName}
    </Alert>
  );
}
