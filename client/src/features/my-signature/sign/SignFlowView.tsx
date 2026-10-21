'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import StepFlow from '@/components/StepFlow';
import { signFields, type SignLayout } from '@/features/forms/signLayout';
import type { EFormDoc, Signer, UploadField } from '@/features/forms/types';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { newSignatureId } from '@/lib/signatureQr';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useState, useTransition } from 'react';
import DocumentViewer from './DocumentViewer';
import RejectDialog from './RejectDialog';
import SignaturePadDialog from './SignaturePadDialog';
import TermsStep from './TermsStep';
import { SIGN_TERMS_VERSION } from './terms';

export const SIGN_STEPS = ['同意授權條款', '閱讀文件', '完成簽名', '確認送出'];

const nowStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 送出簽署時的內容：欄位 id → 手寫簽名 PNG／簽名識別碼，以及同意的條款版本 */
export type SignSubmission = {
  signatures: Record<number, string>;
  signatureIds: Record<number, string>;
  consent: { version: string; agreedAt: string };
};

export type SignFlowViewProps = {
  docInfo: Pick<EFormDoc, 'name' | 'docNumber'>;
  /** 原始 PDF 的同源網址；沒有原始檔（舊資料）時為 null */
  pdfUrl: string | null;
  /** 已在外層讀好的 PDF；提供時不再讀取 pdfUrl */
  pdfDoc?: PDFDocumentProxy | null;
  signer: Pick<Signer, 'name' | 'employeeNo'>;
  layout: SignLayout;
  /** 日期欄位顯示的日期 */
  today: string;
  /** 條款內容與版本；未提供時使用 terms.ts 的條款 */
  terms?: string[];
  termsVersion?: string;
  /** 同意條款後、開始閱讀前呼叫（例如通知後端已開啟文件）；回傳錯誤訊息時停在條款頁 */
  onStart?: () => Promise<string | null>;
  /** 送出簽署；失敗時回傳錯誤訊息，成功時由呼叫端導頁（畫面維持處理中） */
  onSign: (input: SignSubmission) => Promise<string | null>;
  /** 提供時才顯示「拒絕簽署」；失敗時回傳錯誤訊息 */
  onReject?: (reason: string) => Promise<string | null>;
  /** 沒有 onReject 時，提供此說明則仍顯示停用的「拒絕簽署」並標示原因（例如後端尚未支援） */
  rejectUnavailable?: string;
};

/** 簽署流程畫面：同意授權條款 → 閱讀文件 → 逐一完成簽名 → 確認送出（送出方式由呼叫端提供） */
export default function SignFlowView({
  docInfo,
  pdfUrl,
  pdfDoc,
  signer,
  layout,
  today,
  terms,
  termsVersion = SIGN_TERMS_VERSION,
  onStart,
  onSign,
  onReject,
  rejectUnavailable,
}: SignFlowViewProps) {
  const fields = signFields(layout);
  const fieldLabel = (f: UploadField) => {
    const onPage = fields.filter((x) => x.page === f.page);
    const page = f.page === layout.confirmPage ? '簽署確認頁' : `第 ${f.page} 頁`;
    return onPage.length > 1 ? `${page}・簽名欄位 ${onPage.indexOf(f) + 1}` : `${page}・簽名欄位`;
  };

  // 每次進入簽署都須重新同意條款（不保留先前的同意）
  const [consent, setConsent] = useState<{ version: string; agreedAt: string } | null>(null);
  const [readAgreed, setReadAgreed] = useState(false);
  const [signatures, setSignatures] = useState<Record<number, string>>({});
  // 每次確認簽名都產生新的識別碼（重新簽名即換新）
  const [signatureIds, setSignatureIds] = useState<Record<number, string>>({});
  const [activePage, setActivePage] = useState(1);
  const [padField, setPadField] = useState<UploadField | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'sign' | 'reject' | null>(null);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [, startTransition] = useTransition();

  const signedCount = fields.filter((f) => signatures[f.id]).length;
  const allSigned = signedCount === fields.length;
  const ready = readAgreed && allSigned;
  const activeStep = !consent ? 0 : !readAgreed ? 1 : !allSigned ? 2 : 3;

  const openPad = (f: UploadField) => {
    setActivePage(f.page);
    setPadField(f);
  };

  const confirmSignature = (dataUrl: string) => {
    if (!padField) return;
    const next = { ...signatures, [padField.id]: dataUrl };
    setSignatures(next);
    setSignatureIds((prev) => ({ ...prev, [padField.id]: newSignatureId() }));
    setPadField(null);
    // 自動切到下一個尚未簽名的欄位所在頁面（不自動開啟簽名板）
    const nextField = fields.find((f) => !next[f.id]);
    if (nextField) setActivePage(nextField.page);
  };

  const submitSign = () => {
    if (!consent) return;
    setPendingAction('sign');
    startTransition(async () => {
      const message = await onSign({ signatures, signatureIds, consent });
      if (message) {
        setError(message);
        setPendingAction(null);
        setConfirmOpen(false);
      }
    });
  };

  const submitReject = (reason: string) => {
    if (!onReject) return;
    setPendingAction('reject');
    startTransition(async () => {
      const message = await onReject(reason);
      if (message) {
        setError(message);
        setPendingAction(null);
        setRejectOpen(false);
      }
    });
  };

  const agree = async () => {
    setError(undefined);
    if (onStart) {
      setStarting(true);
      const message = await onStart();
      setStarting(false);
      if (message) return setError(message);
    }
    setConsent({ version: termsVersion, agreedAt: nowStr() });
    window.scrollTo({ top: 0 });
  };

  if (!consent) {
    return (
      <Stack spacing={3}>
        <StepFlow steps={SIGN_STEPS} activeIndex={0} />
        {error && (
          <Alert severity="error" onClose={() => setError(undefined)}>
            {error}
          </Alert>
        )}
        <TermsStep
          docName={docInfo.name}
          terms={terms}
          version={termsVersion}
          agreeing={starting}
          onAgree={() => void agree()}
        />
      </Stack>
    );
  }

  const busy = pendingAction !== null;

  return (
    <Stack spacing={3}>
      <StepFlow steps={SIGN_STEPS} activeIndex={activeStep} />
      {error && (
        <Alert severity="error" onClose={() => setError(undefined)}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 300px' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, minWidth: 0 }}>
          <DocumentViewer
            docInfo={docInfo}
            pdfUrl={pdfUrl}
            pdfDoc={pdfDoc}
            signer={signer}
            layout={layout}
            signatures={signatures}
            signatureIds={signatureIds}
            dateText={today}
            activePage={activePage}
            onPageChange={setActivePage}
            onSignField={busy ? undefined : openPad}
          />
        </Paper>

        {/* 簽署面板：捲動文件時固定在畫面上 */}
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, position: { md: 'sticky' }, top: { md: 24 } }}>
          <Stack spacing={2}>
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
                <Typography variant="subheading" component="div">
                  簽名進度
                </Typography>
                <Typography variant="secondary" component="span">
                  {signedCount}/{fields.length}
                </Typography>
              </Box>
              <List disablePadding sx={{ border: 1, borderColor: 'formBorder', borderRadius: 1, overflow: 'hidden' }}>
                {fields.map((f, i) => {
                  const done = !!signatures[f.id];
                  return (
                    <ListItemButton
                      key={f.id}
                      divider={i < fields.length - 1}
                      onClick={() => openPad(f)}
                      disabled={busy}
                      sx={{ gap: 1, py: 1 }}
                    >
                      {done ? (
                        <CheckCircleRoundedIcon fontSize="small" sx={{ color: 'success.main' }} />
                      ) : (
                        <DrawRoundedIcon fontSize="small" sx={{ color: 'warning.dark' }} />
                      )}
                      <Typography variant="content" component="span" sx={{ flex: 1 }}>
                        {fieldLabel(f)}
                      </Typography>
                      <Chip
                        size="small"
                        variant="soft"
                        color={done ? 'success' : 'warning'}
                        label={done ? '已簽名' : '待簽名'}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
              <Typography variant="helper" component="div" sx={{ mt: 1 }}>
                點擊欄位或文件上的「點此簽名」開啟簽名板，每個欄位都需分別親手簽名。
              </Typography>
            </Box>

            <Divider />

            <FormControlLabel
              disabled={busy}
              control={<Checkbox checked={readAgreed} onChange={(e) => setReadAgreed(e.target.checked)} />}
              label={<Typography variant="content">我已閱讀並同意上述文件內容</Typography>}
            />

            <Stack spacing={1}>
              <Button
                size="large"
                variant="contained"
                fullWidth
                disabled={!ready || busy}
                onClick={() => setConfirmOpen(true)}
              >
                確認簽署
              </Button>
              {!ready && (
                <Typography variant="helper" component="div">
                  {!readAgreed && !allSigned
                    ? `請勾選同意文件內容，並完成剩餘 ${fields.length - signedCount} 個簽名。`
                    : !readAgreed
                      ? '請勾選「我已閱讀並同意上述文件內容」。'
                      : `還有 ${fields.length - signedCount} 個簽名欄位尚未簽名。`}
                </Typography>
              )}
              {/* 建立人可在設定簽署時關閉拒絕簽署；server 端也會再檢查 */}
              {onReject && (
                <Button
                  size="large"
                  variant="outlined"
                  color="error"
                  fullWidth
                  disabled={busy}
                  onClick={() => setRejectOpen(true)}
                >
                  拒絕簽署
                </Button>
              )}
              {!onReject && rejectUnavailable && (
                <Tooltip title={rejectUnavailable}>
                  {/* 停用的按鈕不會觸發滑鼠事件，外包 span 讓 Tooltip 仍可顯示 */}
                  <span>
                    <Button size="large" variant="outlined" color="error" fullWidth disabled>
                      拒絕簽署（尚未支援）
                    </Button>
                  </span>
                </Tooltip>
              )}
            </Stack>
          </Stack>
        </Paper>
      </Box>

      <SignaturePadDialog
        open={!!padField}
        subtitle={padField ? `${docInfo.name}・${fieldLabel(padField)}` : ''}
        onClose={() => setPadField(null)}
        onConfirm={confirmSignature}
      />
      <ConfirmDialog
        open={confirmOpen}
        icon={<DrawRoundedIcon />}
        title="確認簽署此文件？"
        description={`「${docInfo.name}」送出後即完成簽署，無法修改或撤回。`}
        confirmLabel={pendingAction === 'sign' ? '送出中…' : '確認簽署'}
        onConfirm={() => !busy && submitSign()}
        onClose={() => !busy && setConfirmOpen(false)}
      />
      <RejectDialog
        open={rejectOpen}
        docName={docInfo.name}
        pending={pendingAction === 'reject'}
        onClose={() => setRejectOpen(false)}
        onConfirm={submitReject}
      />
    </Stack>
  );
}
