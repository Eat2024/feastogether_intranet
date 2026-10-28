'use client';

// 公開簽章驗證頁的內容：GET /api/signature-verifications/:code（不需登入）。
// 只顯示 API 回傳的白名單欄位（Spec 04 FR-009）；須在瀏覽器端呼叫，限流才會以掃描者的 IP 計算。
import { useGetSignatureVerificationQuery } from '@/api/queries';
import type { EsignAuthenticationMethod, SignatureVerification } from '@/api/types';
import { useSnackbar } from '@/components/providers/SnackbarProvider';
import { DOCUMENT_STATUS_META } from '@/features/esign-documents/listQuery';
import { taipeiDateTime } from '@/features/external-signing/taskForm';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import axios from 'axios';
import type { ReactNode } from 'react';

const AUTH_METHOD_LABEL: Record<EsignAuthenticationMethod, string> = {
  internal_session: '員工登入後以本人指派簽署',
  employee_session: '員工登入電子簽系統後簽署',
  email_invitation: '外部簽署人以 Email 邀請連結及驗證碼簽署',
};

/** 時間一律以台北時間顯示，與後端的簽署期限及 PDF 上的日期一致 */
const time = (iso: string | null) => (iso ? `${taipeiDateTime(iso)}（台北時間）` : '—');

function Card({ children }: { children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 }, borderRadius: 2, width: '100%', maxWidth: 720, mx: 'auto' }}>
      {children}
    </Paper>
  );
}

/** 驗證未通過時的整頁結果（查無、驗證失敗、查詢過於頻繁） */
function ResultCard({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', py: 2 }}>
        <Box sx={{ display: 'flex', '& svg': { fontSize: 56 } }}>{icon}</Box>
        <Typography variant="sectionTitle" component="h1">
          {title}
        </Typography>
        <Typography variant="description">{description}</Typography>
        {action}
      </Stack>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '140px minmax(0, 1fr)' }, gap: { xs: 0.5, sm: 2 } }}>
      <Typography variant="label" component="div">
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

/** SHA-256 摘要：等寬字型、可換行，附複製按鈕方便與檔案比對 */
function Digest({ label, value }: { label: string; value: string }) {
  const { showSnackbar } = useSnackbar();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      showSnackbar(`已複製${label}`, 'success');
    } catch {
      showSnackbar('無法複製，請選取文字後手動複製', 'error');
    }
  };
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
      <Typography
        variant="content"
        component="code"
        sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere', bgcolor: 'grey.100', px: 1, py: 0.5, borderRadius: 1 }}
      >
        {value}
      </Typography>
      <Tooltip title={`複製${label}`}>
        <IconButton size="small" aria-label={`複製${label}`} onClick={() => void copy()}>
          <ContentCopyRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function VerifiedResult({ data }: { data: SignatureVerification }) {
  const { signature, document: doc } = data;
  const status = DOCUMENT_STATUS_META[doc.status];
  const completed = doc.status === 'completed';

  return (
    <Card>
      <Stack spacing={3}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ display: 'flex', color: 'success.main', '& svg': { fontSize: 40 } }}>
            <VerifiedRoundedIcon />
          </Box>
          <Box>
            <Typography variant="sectionTitle" component="h1">
              簽章有效
            </Typography>
            <Typography variant="description">此簽章由本系統簽發，簽署紀錄與文件資料比對一致。</Typography>
          </Box>
        </Box>

        <Divider />

        <Stack spacing={2}>
          <Typography variant="subheading" component="h2">
            簽章
          </Typography>
          <Row label="簽署人">
            <Typography variant="content">{signature.signerName}</Typography>
          </Row>
          <Row label="簽署時間">
            <Typography variant="content">{time(signature.signedAt)}</Typography>
          </Row>
          <Row label="驗證方式">
            <Typography variant="content">{AUTH_METHOD_LABEL[signature.authenticationMethod]}</Typography>
          </Row>
        </Stack>

        <Divider />

        <Stack spacing={2}>
          <Typography variant="subheading" component="h2">
            文件
          </Typography>
          <Row label="文件標題">
            <Typography variant="content">{doc.title}</Typography>
          </Row>
          <Row label="文件狀態">
            <Chip size="small" variant="soft" label={status.label} color={status.color} />
          </Row>
          <Row label="原始文件摘要">
            <Digest label="原始文件摘要" value={doc.signedSourceSha256} />
            <Typography variant="helper" component="div" sx={{ mt: 0.5 }}>
              簽署當下原始 PDF 的 SHA-256 摘要
            </Typography>
          </Row>
          {completed ? (
            <>
              <Row label="完成時間">
                <Typography variant="content">{time(doc.completedAt)}</Typography>
              </Row>
              {doc.completedPdfSha256 && (
                <Row label="完成文件摘要">
                  <Digest label="完成文件摘要" value={doc.completedPdfSha256} />
                  <Typography variant="helper" component="div" sx={{ mt: 0.5 }}>
                    此簽署人已簽署副本 PDF 的 SHA-256 摘要
                  </Typography>
                </Row>
              )}
            </>
          ) : doc.status === 'stopped' ? (
            <Row label="停止時間">
              <Typography variant="content">{time(doc.stoppedAt)}</Typography>
            </Row>
          ) : (
            <Typography variant="helper">文件尚未完成，完成後才會有完成文件摘要。</Typography>
          )}
        </Stack>

        {/* Spec 04：QR Code 可能被複製到其他文件，系統無法從掃描判斷紙本內容未被修改 */}
        <Alert severity="info" variant="outlined">
          此頁只能證明上述簽章由本系統簽發。QR Code 可能被複製到其他文件或紙本，請比對文件標題與摘要；
          系統無法從掃描判斷紙本內容是否被修改。
        </Alert>
      </Stack>
    </Card>
  );
}

export default function SignatureVerificationView({ code }: { code: string }) {
  const { data, isPending, isError, error, refetch, isFetching } = useGetSignatureVerificationQuery(code);

  if (isPending) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
        <CircularProgress size={20} />
        <Typography variant="description">驗證中…</Typography>
      </Box>
    );
  }
  if (isError) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    // 查無、格式錯誤、偽造一律相同結果，不揭露原因（Spec 04 FR-010）
    if (status === 404) {
      return (
        <ResultCard
          icon={<HelpOutlineRoundedIcon sx={{ color: 'text.secondary' }} />}
          title="查無此簽章"
          description="此驗證網址無效，或對應的簽章不存在。請確認掃描的 QR Code 或網址是否完整。"
        />
      );
    }
    // 簽署證據、驗證快照、完成文件摘要或稽核鏈不一致：不得顯示為有效
    if (status === 409) {
      return (
        <ResultCard
          icon={<ErrorRoundedIcon sx={{ color: 'error.main' }} />}
          title="驗證失敗"
          description="此簽章的簽署資料與系統紀錄不一致，不可視為有效簽章。如有疑問，請聯絡文件建立人或系統管理員。"
        />
      );
    }
    return (
      <ResultCard
        icon={<ErrorRoundedIcon sx={{ color: 'warning.main' }} />}
        title={status === 429 ? '查詢過於頻繁' : '暫時無法驗證'}
        description={status === 429 ? '請稍後再試。' : '驗證服務暫時無法使用，請稍後再試。'}
        action={
          <Button variant="outlined" onClick={() => refetch()} loading={isFetching}>
            重新驗證
          </Button>
        }
      />
    );
  }
  return <VerifiedResult data={data} />;
}
