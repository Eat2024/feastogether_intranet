'use client';

// 呼叫後端收到 401 時的整頁提示：電子簽沒有自己的登入頁，session 由入口網 launch 建立（見 api/config.ts 的 UNAUTHORIZED_REDIRECT）。
// 嵌入入口網時，重新點選入口網的電子簽選單即會送出 esign:navigate，EmbedBridge 發現沒有 session 後回覆 esign:launch-required，
// 由入口網重新 launch（specs/002-webview-sso-session/contracts/embed-postmessage.md）；這裡不主動送訊息，避免違反「launch-required 只回覆 navigate」的契約。
import LockClockRoundedIcon from '@mui/icons-material/LockClockRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import { dialog, radius } from '@/theme/tokens';
import { useId, useSyncExternalStore } from 'react';

// 是否在入口網 iframe 中：<head> 的腳本在繪製前標記 <html data-embedded>
const subscribe = () => () => {};
const isEmbedded = () => document.documentElement.hasAttribute('data-embedded');

export default function SessionExpiredDialog({ open }: { open: boolean }) {
  const titleId = useId();
  const embedded = useSyncExternalStore(subscribe, isEmbedded, () => false);

  return (
    // 無法關閉：session 失效後所有 API 都會失敗，必須重新進入
    <Dialog
      open={open}
      maxWidth={false}
      aria-labelledby={titleId}
      slotProps={{
        paper: {
          sx: {
            width: dialog.widthConfirm,
            maxWidth: `calc(100% - ${dialog.marginSm * 2}px)`,
            m: `${dialog.marginSm}px`,
            p: 3,
            borderRadius: `${radius.dialogConfirm}px`,
            boxShadow: dialog.shadowConfirm,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            textAlign: 'center',
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', color: 'warning.main', '& svg': { fontSize: 48 } }}>
        <LockClockRoundedIcon />
      </Box>
      <Typography id={titleId} variant="sectionTitle">
        登入已過期
      </Typography>
      <Typography variant="description">
        {embedded
          ? '為了保護資料安全，登入一段時間後需要重新驗證。請重新點選入口網左側選單中的「電子簽」項目，系統會自動重新登入。'
          : '為了保護資料安全，登入一段時間後需要重新驗證。請回到入口網，重新點選「電子簽」進入。'}
      </Typography>
      <Typography variant="helper">尚未儲存的內容將不會保留。</Typography>
      <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
        {/* 已在其他分頁重新進入時，重新整理即可取得新的 session */}
        <Button fullWidth size="large" variant="contained" onClick={() => window.location.reload()}>
          已重新登入，重新整理頁面
        </Button>
      </Box>
    </Dialog>
  );
}
