'use client';

// 簽署頁（後端文件）：從 GET /api/esign/signing-tasks 找出指定 signerPublicId 的任務。
// 可以簽署時進入簽署流程；不能簽署時說明原因，本人已簽署時可預覽原始文件並下載已簽署文件。
import { useGetSigningTasksQuery } from '@/api/queries';
import { signingTaskSourceFileUrl } from '@/api/requests';
import type { EsignSigningTask } from '@/api/types';
import PageHeader from '@/components/PageHeader';
import { formatDate } from '@/features/esign-documents/listQuery';
import DocumentViewer from '@/features/my-signature/sign/DocumentViewer';
import { usePdfDocument } from '@/features/forms/pdf/usePdf';
import { getErrorMessage } from '@/lib/apiError';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import DownloadMyCopyButton from './DownloadMyCopyButton';
import SigningTaskFlow from './SigningTaskFlow';
import { backHref, signBlock } from './taskQuery';

function BackButton({ href }: { href: string }) {
  return (
    <Box>
      <Button variant="text" startIcon={<ArrowBackRoundedIcon />} href={href}>
        返回我的電子簽
      </Button>
    </Box>
  );
}

function Loading() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8 }}>
      <CircularProgress size={20} />
      <Typography variant="description">載入文件中…</Typography>
    </Box>
  );
}

export default function SigningTaskView({ signerPublicId }: { signerPublicId: string }) {
  const { data, isPending, isError, error, refetch, isFetching } = useGetSigningTasksQuery();

  if (isPending) return <Loading />;
  if (isError) {
    return (
      <>
        <BackButton href="/my-signature" />
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()} loading={isFetching}>
              重新載入
            </Button>
          }
        >
          無法取得簽署任務：{getErrorMessage(error)}
        </Alert>
      </>
    );
  }
  const task = data.find((t) => t.signerPublicId === signerPublicId);
  if (!task) {
    // 不是本人的任務就當作不存在，不透露文件資訊
    return (
      <>
        <BackButton href="/my-signature" />
        <Alert severity="warning" variant="outlined">
          找不到此簽署任務，可能是連結有誤，或你不是此文件的簽署人。
        </Alert>
      </>
    );
  }
  // 以 key 區分任務：換到另一份文件時不沿用簽署中的狀態
  return <Task key={task.signerPublicId} task={task} />;
}

function Task({ task }: { task: EsignSigningTask }) {
  const { document: doc, signer } = task;
  // 以進入頁面的時間判斷可否簽署；送出時後端會再檢查一次
  const [now] = useState(() => new Date());
  const block = signBlock(task, now);

  return (
    <>
      <BackButton href={backHref(task)} />
      <PageHeader
        title={doc.title}
        description={[
          doc.docNumber,
          doc.createdBy && `建立人 ${doc.createdBy.name}（${doc.createdBy.employeeNo}）`,
          `${doc.isReopened ? '補簽期限' : '簽署期限'} ${formatDate(doc.signEndAt) ?? '不限'}`,
        ]
          .filter(Boolean)
          .join('・')}
      />
      {block ? (
        <>
          <Alert
            severity={signer.status === 'signed' ? 'success' : 'info'}
            variant="outlined"
            action={
              signer.status === 'signed' ? (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {/* 與已簽署文件上 QR Code 相同的公開驗證網址（Spec 04 FR-003） */}
                  {signer.verificationUrl && (
                    <Button
                      size="large"
                      variant="outlined"
                      startIcon={<VerifiedRoundedIcon />}
                      href={signer.verificationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      查看簽章驗證
                    </Button>
                  )}
                  <DownloadMyCopyButton task={task} />
                </Box>
              ) : undefined
            }
          >
            {block}
          </Alert>
          {/* 待簽署者在簽署期間外無法讀取文件；本人已簽署後仍可預覽原始文件 */}
          {signer.status === 'signed' && <SignedPreview task={task} />}
        </>
      ) : (
        <SigningTaskFlow task={task} />
      )}
    </>
  );
}

/** 已簽署後的原始文件預覽；本人的簽名與簽署日期在下載的已簽署文件中 */
function SignedPreview({ task }: { task: EsignSigningTask }) {
  const { doc, error, loading } = usePdfDocument(signingTaskSourceFileUrl(task.signerPublicId));
  const [activePage, setActivePage] = useState(1);
  if (loading) return <Loading />;
  if (error || !doc) {
    return (
      <Alert severity="warning" variant="outlined">
        無法讀取文件內容，請改用「下載已簽署文件」查看。
      </Alert>
    );
  }
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <Typography variant="helper" component="div" sx={{ mb: 2 }}>
        以下為原始文件；你的簽名與簽署日期請見「下載已簽署文件」。
      </Typography>
      <DocumentViewer
        docInfo={{ name: task.document.title, docNumber: task.document.docNumber }}
        pdfUrl={null}
        pdfDoc={doc}
        signer={{ name: task.signer.name, employeeNo: task.signer.employeeNo ?? '' }}
        layout={{ pageCount: doc.numPages, originalPages: doc.numPages, confirmPage: null, fields: [] }}
        signatures={{}}
        dateText=""
        activePage={activePage}
        onPageChange={setActivePage}
      />
    </Paper>
  );
}
