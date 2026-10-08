'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState, useTransition } from 'react';
import { saveSigners } from '../actions';
import { formOptions, WATERMARK_TEXT, type FormOptions } from '../options';
import type { EFormDoc, OrgDept } from '../types';
import DeadlineRangePicker from './DeadlineRangePicker';
import EmailSignerInput, { type EmailSigner } from './EmailSignerInput';
import StaffTreePicker from './StaffTreePicker';

const DEADLINE_REQUIRED = '請選擇簽署期間的開始日與結束日';

const OPTION_ITEMS: { key: keyof FormOptions; label: string; description: string }[] = [
  {
    key: 'watermark',
    label: '匯出文件加上浮水印',
    description: `下載或匯出的已簽署文件（PDF）每一頁都會加上「${WATERMARK_TEXT}」浮水印。`,
  },
  {
    key: 'allowReject',
    label: '開放拒絕簽署',
    description: '簽署人可以選擇拒絕簽署並填寫原因；取消勾選後，簽署人只能簽署。',
  },
];

/** 設定簽署人員與簽署期間（流程第二步） */
export default function SignersEditor({
  form,
  org,
}: {
  form: EFormDoc;
  /** 組織架構（部門樹與在職員工） */
  org: OrgDept[];
}) {
  // 組織架構中的同仁（員工 id）與以 Email 加入的簽署人分開管理
  const [selected, setSelected] = useState(
    () => new Set(form.signers.filter((s) => !s.email).map((s) => s.id)),
  );
  const [emailSigners, setEmailSigners] = useState<EmailSigner[]>(() =>
    form.signers
      .filter((s): s is typeof s & { email: string } => !!s.email)
      .map((s) => ({ email: s.email, name: s.name === s.email ? '' : s.name })),
  );
  const totalSigners = selected.size + emailSigners.length;
  const [deadline, setDeadline] = useState<{
    start: string | null;
    end: string | null;
  }>({
    start: null,
    end: null,
  });
  const [options, setOptions] = useState<FormOptions>(() => formOptions(form));
  const [error, setError] = useState<string>();
  const [deadlineError, setDeadlineError] = useState<string>();
  const [pendingAction, setPendingAction] = useState<'save' | 'publish' | null>(
    null,
  );
  const [, startTransition] = useTransition();

  const submit = (publish: boolean) => {
    // 簽署期間於發起時必填；暫存設定時不需要（暫存不會保存簽署期間）
    const missingDeadline = publish && (!deadline.start || !deadline.end);
    if (missingDeadline) setDeadlineError(DEADLINE_REQUIRED);
    if (totalSigners === 0) {
      setError('請至少選擇一位需簽署人員');
      return;
    }
    if (missingDeadline) return;
    setPendingAction(publish ? 'publish' : 'save');
    startTransition(async () => {
      const result = await saveSigners({
        id: form.id,
        signerIds: [...selected],
        emailSigners,
        deadline,
        options,
        publish,
      });
      if (result?.error) {
        if (result.error === DEADLINE_REQUIRED) setDeadlineError(result.error);
        else setError(result.error);
        setPendingAction(null);
      }
    });
  };

  const busy = pendingAction !== null;

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="subheading" component="div" sx={{ mb: 1 }}>
              需簽署人員
            </Typography>
            <StaffTreePicker
              org={org}
              selected={selected}
              error={!!error && !error.startsWith('結束日')}
              onChange={(next) => {
                setSelected(next);
                setError(undefined);
              }}
            />
            <Box sx={{ mt: 2 }}>
              <EmailSignerInput
                value={emailSigners}
                onChange={(next) => {
                  setEmailSigners(next);
                  setError(undefined);
                }}
              />
            </Box>
            <Typography
              variant="secondary"
              component="div"
              sx={{ mt: 1.5, ...(error && { color: 'error.dark' }) }}
            >
              {error ??
                `共 ${totalSigners} 位簽署人${emailSigners.length ? `（組織架構 ${selected.size} 位、Email ${emailSigners.length} 位）` : ''}`}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subheading" component="div" sx={{ mb: 1 }}>
              簽署期間
            </Typography>
            <DeadlineRangePicker
              start={deadline.start}
              end={deadline.end}
              onChange={(range) => {
                setDeadline(range);
                if (range.start && range.end) setDeadlineError(undefined);
              }}
            />
            <Typography
              variant="label"
              component="div"
              sx={{ mt: 1, ...(deadlineError && { color: 'error.dark' }) }}
            >
              {deadlineError ??
                (deadline.start || deadline.end
                  ? `已選擇：${deadline.start ?? '（請選擇開始日）'} ～ ${deadline.end ?? '（請選擇結束日）'}`
                  : '請選擇開始日與結束日，簽署人需在此期間內完成簽署。')}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subheading" component="div" sx={{ mb: 1 }}>
              可選功能
            </Typography>
            <Stack spacing={1}>
              {OPTION_ITEMS.map((item) => (
                <FormControlLabel
                  key={item.key}
                  sx={{ alignItems: 'flex-start', mx: 0 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={options[item.key]}
                      disabled={busy}
                      onChange={(e) => setOptions((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                      sx={{ mt: -0.5 }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="content" component="div">
                        {item.label}
                      </Typography>
                      <Typography variant="helper" component="div">
                        {item.description}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </Paper>

      {error &&
        error !== '請至少選擇一位需簽署人員' &&
        error !== DEADLINE_REQUIRED && <Alert severity="error">{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="large"
          variant="outlined"
          href={`/forms/${form.id}/edit`}
          disabled={busy}
        >
          上一步，回到上傳文件
        </Button>
        <Button
          size="large"
          variant="outlined"
          onClick={() => submit(false)}
          loading={pendingAction === 'save'}
          disabled={busy}
        >
          儲存設定（暫不發起）
        </Button>
        {/* 取消與主要動作靠右，主鈕在最右 */}
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          <Button size="large" variant="outlined" href="/forms" disabled={busy}>
            取消
          </Button>
          <Button
            size="large"
            variant="contained"
            onClick={() => submit(true)}
            loading={pendingAction === 'publish'}
            disabled={busy}
          >
            發起簽署，通知所有簽署人
          </Button>
        </Box>
      </Box>
    </Stack>
  );
}
