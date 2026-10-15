'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import StepFlow from '@/components/StepFlow';
import { formOptions } from '@/features/forms/options';
import { getSignLayout, signFields } from '@/features/forms/signLayout';
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
import Typography from '@mui/material/Typography';
import { newSignatureId } from '@/lib/signatureQr';
import { useState, useTransition } from 'react';
import { rejectDocument, signDocument } from '../actions';
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

/** 簽署流程：同意授權條款 → 閱讀文件 → 逐一完成簽名 → 確認送出 */
export default function SignFlow({ form, me, today }: { form: EFormDoc; me: Signer; today: string }) {
  const layout = getSignLayout(form)!;
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
      const result = await signDocument({ formId: form.id, signatures, signatureIds, consent });
      if (result?.error) {
        setError(result.error);
        setPendingAction(null);
        setConfirmOpen(false);
      }
    });
  };

  const submitReject = (reason: string) => {
    setPendingAction('reject');
    startTransition(async () => {
      const result = await rejectDocument({ formId: form.id, reason });
      if (result?.error) {
        setError(result.error);
        setPendingAction(null);
        setRejectOpen(false);
      }
    });
  };

  if (!consent) {
    return (
      <Stack spacing={3}>
        <StepFlow steps={SIGN_STEPS} activeIndex={0} />
        <TermsStep
          docName={form.name}
          onAgree={() => {
            setConsent({ version: SIGN_TERMS_VERSION, agreedAt: nowStr() });
            window.scrollTo({ top: 0 });
          }}
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
            form={form}
            signer={me}
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
              {/* 發起人可在設定簽署時關閉拒絕簽署；server 端也會再檢查 */}
              {formOptions(form).allowReject && (
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
            </Stack>
          </Stack>
        </Paper>
      </Box>

      <SignaturePadDialog
        open={!!padField}
        subtitle={padField ? `${form.name}・${fieldLabel(padField)}` : ''}
        onClose={() => setPadField(null)}
        onConfirm={confirmSignature}
      />
      <ConfirmDialog
        open={confirmOpen}
        icon={<DrawRoundedIcon />}
        title="確認簽署此文件？"
        description={`「${form.name}」送出後即完成簽署，無法修改或撤回。`}
        confirmLabel={pendingAction === 'sign' ? '送出中…' : '確認簽署'}
        onConfirm={() => !busy && submitSign()}
        onClose={() => !busy && setConfirmOpen(false)}
      />
      <RejectDialog
        open={rejectOpen}
        docName={form.name}
        pending={pendingAction === 'reject'}
        onClose={() => setRejectOpen(false)}
        onConfirm={submitReject}
      />
    </Stack>
  );
}
