'use client';

import ConfirmDialog from '@/components/ConfirmDialog';
import StepFlow from '@/components/StepFlow';
import { SHEET_REMARK_MAX, SHEET_SIGN_FIELD_ID } from '@/features/forms/sheet/rules';
import SheetView from '@/features/forms/sheet/SheetView';
import type { EFormDoc, SheetInfo, Signer } from '@/features/forms/types';
import { newSignatureId } from '@/lib/signatureQr';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, useTransition } from 'react';
import { signDocument } from '../actions';
import SignaturePadDialog from './SignaturePadDialog';
import TermsStep from './TermsStep';
import { SIGN_TERMS_VERSION } from './terms';

const SHEET_SIGN_STEPS = ['同意授權條款', '簽到', '確認送出'];

const nowStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * 簽到表的簽到流程：同意授權條款 → 在自己那一列簽到（可填備註）→ 確認送出。
 * 只顯示本人那一列；名單外人員（walkIn）會使用空白列，送出後才加入文件。
 */
export default function SheetSignFlow({
  form,
  sheet,
  me,
  rowNo,
}: {
  form: EFormDoc;
  sheet: SheetInfo;
  me: Signer;
  /** 本人在簽到表上的序號 */
  rowNo: number;
}) {
  const [consent, setConsent] = useState<{ version: string; agreedAt: string } | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureId, setSignatureId] = useState<string | null>(null);
  const [remark, setRemark] = useState('');
  const [padOpen, setPadOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const remarkLength = Array.from(remark.trim()).length;
  const remarkTooLong = remarkLength > SHEET_REMARK_MAX;

  if (!consent) {
    return (
      <Stack spacing={3}>
        <StepFlow steps={SHEET_SIGN_STEPS} activeIndex={0} />
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

  const submit = () => {
    if (!signature || !signatureId || remarkTooLong) return;
    startTransition(async () => {
      const result = await signDocument({
        formId: form.id,
        signatures: { [SHEET_SIGN_FIELD_ID]: signature },
        signatureIds: { [SHEET_SIGN_FIELD_ID]: signatureId },
        consent,
        remark,
      });
      if (result?.error) {
        setError(result.error);
        setConfirmOpen(false);
      }
    });
  };

  return (
    <Stack spacing={3}>
      <StepFlow steps={SHEET_SIGN_STEPS} activeIndex={signature ? 2 : 1} />
      {me.walkIn && (
        <Alert severity="info" variant="outlined">
          你不在原本的簽到名單中，將使用簽到表的空白列簽到。
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(undefined)}>
          {error}
        </Alert>
      )}

      <SheetView
        sheet={sheet}
        rows={[{ no: rowNo, signer: me }]}
        highlight={me.id}
        renderSign={() =>
          signature ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 簽名為 data URL */}
              <img src={signature} alt="你的簽名" style={{ maxHeight: 36, maxWidth: '100%' }} />
              <Button size="small" onClick={() => setPadOpen(true)} disabled={pending}>
                重新簽名
              </Button>
            </Box>
          ) : (
            <Button size="small" variant="contained" startIcon={<DrawRoundedIcon />} onClick={() => setPadOpen(true)}>
              點此簽到
            </Button>
          )
        }
        renderRemark={() => (
          <TextField
            size="small"
            fullWidth
            value={remark}
            disabled={pending}
            placeholder="選填"
            onChange={(e) => setRemark(e.target.value)}
            error={remarkTooLong}
            slotProps={{ htmlInput: { 'aria-label': '簽到備註' } }}
          />
        )}
      />
      <Typography variant="helper" component="div" sx={{ mt: -2 }}>
        備註為選填，最多 {SHEET_REMARK_MAX} 字（目前 {remarkLength} 字）；簽到時間以送出時間為準。
      </Typography>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        {/* 名單外人員簽到前，這份文件還不在他的「我的電子簽」中，不提供返回 */}
        {!me.walkIn && (
          <Button size="large" variant="outlined" href="/my-signature" disabled={pending}>
            取消
          </Button>
        )}
        <Button
          size="large"
          variant="contained"
          disabled={!signature || remarkTooLong}
          loading={pending}
          onClick={() => setConfirmOpen(true)}
        >
          確認簽到
        </Button>
      </Box>

      <SignaturePadDialog
        open={padOpen}
        subtitle={`${form.name}・第 ${rowNo} 列簽到`}
        onClose={() => setPadOpen(false)}
        onConfirm={(dataUrl) => {
          setSignature(dataUrl);
          // 每次確認簽名都產生新的識別碼（重新簽名即換新）
          setSignatureId(newSignatureId());
          setPadOpen(false);
        }}
      />
      <ConfirmDialog
        open={confirmOpen}
        icon={<DrawRoundedIcon />}
        title="確認簽到？"
        description={`「${form.name}」送出後即完成簽到，無法修改或撤回。`}
        confirmLabel={pending ? '送出中…' : '確認簽到'}
        onConfirm={() => !pending && submit()}
        onClose={() => !pending && setConfirmOpen(false)}
      />
    </Stack>
  );
}
