'use client';

// 簽署頁（後端文件）：從 GET /api/esign/signing-tasks 找出指定 signerPublicId 的任務。
// 內部員工須從 Email 邀請並通過驗證碼才能簽署、拒簽或下載本人副本（Spec 010），
// 舊的個人操作 API 一律回 403 ESIGN_EMAIL_OTP_REQUIRED，此頁只顯示狀態並引導從邀請信開啟。
import { useGetSigningTasksQuery } from '@/api/queries';
import type { EsignSigningTask } from '@/api/types';
import PageHeader from '@/components/PageHeader';
import { formatDate } from '@/features/esign-documents/listQuery';
import { getErrorMessage } from '@/lib/apiError';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
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
  // 以進入頁面的時間判斷目前狀態（已簽署、已到期、尚未開始等）
  const [now] = useState(() => new Date());
  const block = signBlock(task, now);
  const creator = doc.createdBy ? `建立人 ${doc.createdBy.name}` : '建立人';

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
      {signer.status === 'signed' ? (
        <Alert
          severity="success"
          variant="outlined"
          action={
            // 與已簽署文件上 QR Code 相同的公開驗證網址（Spec 04 FR-003）
            signer.verificationUrl && (
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
            )
          }
        >
          {block}
          <Typography variant="helper" component="div" sx={{ mt: 0.5 }}>
            如需下載已簽署文件，請從原邀請信開啟並完成 Email 驗證碼驗證後下載。
          </Typography>
        </Alert>
      ) : block ? (
        // 已拒絕、已停止、已到期、尚未開始等
        <Alert severity="info" variant="outlined">
          {block}
        </Alert>
      ) : (
        <InvitationGuide creator={creator} />
      )}
    </>
  );
}

/**
 * 待簽署：內部員工也須從 Email 邀請並通過驗證碼才能簽署或拒簽（Spec 010 FR-011），
 * 一般員工登入不能直接簽署，此頁只說明簽署方式。
 */
function InvitationGuide({ creator }: { creator: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Box sx={{ display: 'flex', color: 'primary.main', '& svg': { fontSize: 32 } }}>
          <MarkEmailReadRoundedIcon />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="sectionTitle" component="h2" sx={{ mb: 1 }}>
            請從邀請信開啟文件簽署
          </Typography>
          <Typography variant="description" component="div">
            為確認是本人簽署，電子簽署須透過寄到你信箱的邀請信進行：
          </Typography>
          <Box component="ol" sx={{ m: 0, mt: 1, pl: 2.5 }}>
            {[
              '開啟系統寄出的「電子簽署邀請」信件，點擊信中的連結。',
              '依畫面指示寄送並輸入 Email 驗證碼（6 位數字，10 分鐘內有效）。',
              '驗證通過後即可閱讀文件並簽署；如需拒絕簽署也在同一頁操作。',
            ].map((step) => (
              <Typography key={step} component="li" variant="content" sx={{ display: 'list-item', mb: 0.5 }}>
                {step}
              </Typography>
            ))}
          </Box>
          <Typography variant="helper" component="div" sx={{ mt: 1 }}>
            找不到邀請信時，請先檢查垃圾郵件匣，或聯絡{creator}重新寄送簽署通知。
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}
