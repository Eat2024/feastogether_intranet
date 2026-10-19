'use client';

// 設定簽署（後端文件）：選擇簽署人與簽署期間，以 POST /api/esign/documents/:id/initiations 一次發起。
// 第一步放的欄位是所有簽署人共用的位置，後端會替每位簽署人各產生一份個人副本。
import { useGetDocumentQuery } from '@/api/queries';
import { queryKeys } from '@/api/query-keys';
import { getSignerCandidates, initiateDocument } from '@/api/requests';
import type { EsignDocumentDetail, EsignSignerInput, InitiateDocumentBody } from '@/api/types';
import PageHeader from '@/components/PageHeader';
import DeadlineRangePicker from '@/features/forms/editor/DeadlineRangePicker';
import EmailSignerInput, { type EmailSigner } from '@/features/forms/editor/EmailSignerInput';
import StaffTreePicker from '@/features/forms/editor/StaffTreePicker';
import { WATERMARK_TEXT } from '@/features/forms/options';
import type { OrgDept } from '@/features/forms/types';
import { getErrorMessage } from '@/lib/apiError';
import { emailSignerId, isValidEmail, normalizeEmail } from '@/lib/email';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

const DEADLINE_REQUIRED = '請選擇簽署期間的開始日與結束日';
const NOT_CONNECTED = '尚未串接後端';

// 浮水印與拒絕簽署後端尚未提供，發起時一律送 false；選項先顯示為停用
const OPTION_ITEMS: { key: 'watermark' | 'allowReject'; label: string; description: string }[] = [
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

type Staff = { name: string; employeeNo: string };

/** 組織架構攤平成 員工 id → 姓名、員編 */
function staffIndex(depts: OrgDept[], into = new Map<string, Staff>()) {
  for (const d of depts) {
    for (const e of d.employees) into.set(e.id, { name: e.name, employeeNo: e.employeeNo ?? e.id });
    staffIndex(d.children, into);
  }
  return into;
}

/** 簽署人（選擇順序：組織架構同仁在前、Email 在後） */
type PickedSigner = { key: string; label: string } & ({ type: 'user'; employeeNo: string } | { type: 'email'; name: string; email: string });

/** 以完整員編查出後端 userId；查無或不唯一時回報是哪一位 */
async function resolveUserIds(signers: PickedSigner[]): Promise<Map<string, string>> {
  const users = signers.filter((s) => s.type === 'user');
  const results = await Promise.all(
    users.map(async (s) => {
      const match = (await getSignerCandidates(s.employeeNo)).find((c) => c.employeeNo === s.employeeNo);
      if (!match) throw new Error(`找不到 ${s.label} 的員工帳號，無法指定為簽署人`);
      return [s.key, match.id] as const;
    }),
  );
  return new Map(results);
}

/** YYYY/MM/DD → 當天開始（00:00）或結束（23:59:59.999）的 ISO 時間（本地時區） */
const dayBoundary = (date: string, edge: 'start' | 'end') => {
  const d = dayjs(date.replaceAll('/', '-'));
  return (edge === 'start' ? d.startOf('day') : d.endOf('day')).toISOString();
};

export default function DocumentSignersEditor({ documentId, org }: { documentId: string; org: OrgDept[] }) {
  const { data: doc, isPending, isError, error, refetch, isFetching } = useGetDocumentQuery(documentId);

  if (isPending) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
        <CircularProgress size={20} />
        <Typography variant="description">載入文件中…</Typography>
      </Box>
    );
  }
  if (isError) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => refetch()} loading={isFetching}>
            重新載入
          </Button>
        }
      >
        無法取得文件：{getErrorMessage(error)}
      </Alert>
    );
  }
  if (doc.status !== 'draft') {
    return (
      <Alert severity="info" action={<Button href="/forms">返回列表</Button>}>
        「{doc.title}」已發起簽署，無法再修改簽署設定。
      </Alert>
    );
  }
  return <Editor doc={doc} org={org} />;
}

function Editor({ doc, org }: { doc: EsignDocumentDetail; org: OrgDept[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const staff = useMemo(() => staffIndex(org), [org]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [emailSigners, setEmailSigners] = useState<EmailSigner[]>([]);
  const [deadline, setDeadline] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [signerError, setSignerError] = useState<string>();
  const [deadlineError, setDeadlineError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();

  const fields = useMemo(() => [...doc.fields].sort((a, b) => a.sortOrder - b.sortOrder), [doc.fields]);

  const signers: PickedSigner[] = useMemo(() => {
    const users = [...selected].flatMap((id): PickedSigner[] => {
      const s = staff.get(id);
      return s ? [{ key: `user:${id}`, label: `${s.name}（${s.employeeNo}）`, type: 'user', employeeNo: s.employeeNo }] : [];
    });
    const emails = emailSigners.map((e): PickedSigner => {
      const email = normalizeEmail(e.email);
      const name = e.name.trim();
      // 後端要求姓名必填；未填時以 Email 代替
      return { key: emailSignerId(email), label: name ? `${name}（${email}）` : email, type: 'email', name: name || email, email };
    });
    return [...users, ...emails];
  }, [selected, emailSigners, staff]);

  // 後端要求至少一個共用簽名欄位
  const hasSignatureField = fields.some((f) => f.type === 'signature');

  const initiate = useMutation({
    mutationFn: async (): Promise<number> => {
      const userIds = await resolveUserIds(signers);
      const signerInputs: EsignSignerInput[] = signers.map((s) =>
        s.type === 'user' ? { type: 'user', userId: userIds.get(s.key)! } : { type: 'email', name: s.name, email: s.email },
      );
      const body: InitiateDocumentBody = {
        signers: signerInputs,
        // 共用欄位：所有簽署人簽同一組位置，照草稿原樣送出
        fields: fields.map(({ type, page, xPercent, yPercent, widthPercent, heightPercent, sortOrder }) => ({
          type,
          page,
          xPercent,
          yPercent,
          widthPercent,
          heightPercent,
          sortOrder,
        })),
        signStartAt: dayBoundary(deadline.start!, 'start'),
        signEndAt: dayBoundary(deadline.end!, 'end'),
        watermark: false,
        allowReject: false,
      };
      await initiateDocument({ id: doc.id, body });
      return signers.length;
    },
    meta: { suppressGlobalErrorToast: true },
    onSuccess: (count) => {
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENTS] });
      void queryClient.invalidateQueries({ queryKey: [queryKeys.ESIGN_DOCUMENT, doc.id] });
      router.push(`/forms?flash=published&count=${count}`);
    },
    // 查無員工帳號時是自訂的 Error，其餘為後端回應
    onError: (err) =>
      setSubmitError(
        !axios.isAxiosError(err) && err instanceof Error ? err.message : getErrorMessage(err, '發起簽署失敗，請稍後再試'),
      ),
  });

  const submit = () => {
    setSubmitError(undefined);
    let ok = true;
    if (signers.length === 0) {
      setSignerError('請至少選擇一位需簽署人員');
      ok = false;
    } else if (emailSigners.some((e) => !isValidEmail(normalizeEmail(e.email)))) {
      setSignerError('Email 格式不正確');
      ok = false;
    }
    if (!deadline.start || !deadline.end) {
      setDeadlineError(DEADLINE_REQUIRED);
      ok = false;
    }
    if (!hasSignatureField) ok = false;
    if (ok) initiate.mutate();
  };

  const busy = initiate.isPending || initiate.isSuccess;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="設定簽署"
        description={`「${doc.title}」${doc.docNumber ? `（${doc.docNumber}）` : ''}－ 為此文件指定需簽署的人員，並設定簽署期間。`}
      />
      {!hasSignatureField && (
        <Alert severity="warning" variant="outlined">
          此文件沒有簽名欄位（系統簽署確認頁後端尚未支援），目前無法發起簽署。
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="subheading" component="div" sx={{ mb: 1 }}>
              需簽署人員
            </Typography>
            <StaffTreePicker
              org={org}
              selected={selected}
              error={!!signerError}
              onChange={(next) => {
                setSelected(next);
                setSignerError(undefined);
              }}
            />
            <Box sx={{ mt: 2 }}>
              <EmailSignerInput
                value={emailSigners}
                onChange={(next) => {
                  setEmailSigners(next);
                  setSignerError(undefined);
                }}
              />
            </Box>
            <Typography
              variant="secondary"
              component="div"
              sx={{ mt: 1.5, ...(signerError && { color: 'error.dark' }) }}
            >
              {signerError ??
                `共 ${signers.length} 位簽署人${emailSigners.length ? `（組織架構 ${selected.size} 位、Email ${emailSigners.length} 位）` : ''}`}
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
                    <Checkbox size="small" checked={false} disabled sx={{ mt: -0.5 }} />
                  }
                  label={
                    <Box>
                      <Typography variant="content" component="div">
                        {item.label}（尚未支援）
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

      {submitError && <Alert severity="error">{submitError}</Alert>}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="large" variant="outlined" href={`/forms/${doc.id}/edit`} disabled={busy}>
          上一步，回到上傳文件
        </Button>
        {/* TODO: 串接 PUT draftSave、fields（暫存設定） */}
        <Tooltip title={NOT_CONNECTED}>
          <span>
            <Button size="large" variant="outlined" disabled>
              儲存設定（暫不發起）
            </Button>
          </span>
        </Tooltip>
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
          <Button size="large" variant="outlined" href="/forms" disabled={busy}>
            取消
          </Button>
          <Button size="large" variant="contained" onClick={submit} loading={busy} disabled={!hasSignatureField}>
            發起簽署，通知所有簽署人
          </Button>
        </Box>
      </Box>
    </Stack>
  );
}
