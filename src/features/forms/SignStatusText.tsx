import Typography from '@mui/material/Typography';
import type { Signer } from './types';

const SIGN_STATUS_TEXT: Record<Signer['status'], (s: Signer) => string> = {
  signed: (s) => `已簽署・${s.signedAt}`,
  rejected: (s) => `已拒絕・${s.rejectedAt}`,
  pending: () => '待簽署',
};

// success／error 主色白底對比不足，文字用 dark
const SIGN_STATUS_COLOR: Record<Signer['status'], string> = {
  signed: 'success.dark',
  rejected: 'error.dark',
  pending: 'text.secondary',
};

/** 簽署人的簽署狀態文字（已簽署・時間／已拒絕・時間／待簽署） */
export default function SignStatusText({ signer }: { signer: Signer }) {
  return (
    <Typography
      variant="content"
      component="span"
      sx={{ color: SIGN_STATUS_COLOR[signer.status], whiteSpace: 'nowrap' }}
    >
      {SIGN_STATUS_TEXT[signer.status](signer)}
    </Typography>
  );
}
