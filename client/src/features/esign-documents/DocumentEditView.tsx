'use client';

// 編輯文件（後端文件）：讀取草稿後以上傳編輯器修改，儲存呼叫 PATCH /api/esign/documents/:id。
// 後端只允許修改尚未發起的草稿。
import { useGetDocumentQuery } from '@/api/queries';
import PageHeader from '@/components/PageHeader';
import StepFlow from '@/components/StepFlow';
import UploadEditor from '@/features/forms/editor/UploadEditor';
import { CREATE_STEPS } from '@/features/forms/editor/steps';
import { getErrorMessage } from '@/lib/apiError';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

export default function DocumentEditView({ documentId }: { documentId: string }) {
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
      <Alert severity="info" action={<Button href={`/forms/${doc.id}`}>檢視簽署進度</Button>}>
        「{doc.title}」已發起簽署，無法再修改文件內容。
      </Alert>
    );
  }
  return (
    <>
      <StepFlow steps={CREATE_STEPS} activeIndex={0} />
      <PageHeader
        title="編輯文件"
        description={`「${doc.title}」（${doc.docNumber}）－ 上傳 PDF 文件，逐頁預覽並指定簽名要落在哪裡。`}
      />
      {/* 以 id 為 key：重新取得資料後不沿用上一份的編輯狀態 */}
      <UploadEditor key={doc.id} draft={doc} />
    </>
  );
}
