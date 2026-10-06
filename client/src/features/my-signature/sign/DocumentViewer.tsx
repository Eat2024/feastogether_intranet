'use client';

import { FIELD_H_PCT, FIELD_W_PCT, type SignLayout } from '@/features/forms/signLayout';
import type { EFormDoc, Signer, UploadField } from '@/features/forms/types';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SignatureQr from './SignatureQr';

type DocumentViewerProps = {
  form: EFormDoc;
  signer: Pick<Signer, 'name' | 'employeeNo'>;
  layout: SignLayout;
  /** 欄位 id → 手寫簽名 PNG */
  signatures: Record<number, string>;
  /** 欄位 id → 簽名識別碼（顯示追蹤 QR code） */
  signatureIds?: Record<number, string>;
  /** 日期欄位顯示的日期 */
  dateText: string;
  activePage: number;
  onPageChange: (page: number) => void;
  /** 提供時簽名欄位可點擊（進行簽名）；未提供為唯讀 */
  onSignField?: (field: UploadField) => void;
};

/** 頁面縮圖：需簽名的頁面標示「需簽名」，該頁都簽完改為「已簽名」 */
function PageThumb({
  label,
  active,
  signCount,
  signedCount,
  onClick,
}: {
  label: string;
  active: boolean;
  signCount: number;
  signedCount: number;
  onClick: () => void;
}) {
  const done = signCount > 0 && signedCount === signCount;
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'center', flex: 'none' }}>
      <Box
        component="button"
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={`${label}${signCount ? `，需簽名 ${signCount} 處` : ''}`}
        sx={{
          width: 96,
          height: 132,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          bgcolor: 'background.paper',
          border: 1.5,
          borderColor: active ? 'primary.main' : 'grey.300',
          boxShadow: (theme) => (active ? `0 0 0 3px ${theme.palette.primary.less}` : 'none'),
          borderRadius: 1,
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        <Stack spacing={0.5} sx={{ width: '70%' }}>
          {[100, 70, 85].map((w) => (
            <Box key={w} sx={{ height: 3, width: `${w}%`, bgcolor: 'grey.300', borderRadius: 1 }} />
          ))}
        </Stack>
        <Typography variant="helper">{label}</Typography>
      </Box>
      {signCount > 0 && (
        <Chip
          size="small"
          variant="soft"
          color={done ? 'success' : 'warning'}
          icon={<DrawRoundedIcon />}
          label={done ? '已簽名' : `需簽名 ${signCount - signedCount} 處`}
        />
      )}
    </Stack>
  );
}

/** 原文件頁面的示意內容（與上傳編輯器相同） */
function OriginalPageContent({ page, isLast }: { page: number; isLast: boolean }) {
  return (
    <>
      <Typography variant="label" component="div" sx={{ mb: 2 }}>
        第 {page} 頁
      </Typography>
      {[40, 80, 60, 80, 40, 80, 60].map((w, i) => (
        <Box key={i} sx={{ height: 7, width: `${w}%`, mb: 1, bgcolor: 'grey.100', borderRadius: 1 }} />
      ))}
      {isLast && (
        <Stack spacing={1.5} sx={{ mt: 3 }}>
          {['甲方', '乙方', '日期'].map((t) => (
            <Typography key={t} variant="helper">
              {t}：＿＿＿＿＿＿＿＿
            </Typography>
          ))}
        </Stack>
      )}
    </>
  );
}

/** 系統簽署確認頁的內容 */
function ConfirmPageContent({
  form,
  signer,
  pages,
}: {
  form: EFormDoc;
  signer: DocumentViewerProps['signer'];
  pages: number;
}) {
  return (
    <>
      <Typography variant="subheading" component="div" sx={{ textAlign: 'center', mb: 2 }}>
        電子簽署確認書
      </Typography>
      <Stack>
        <Typography variant="helper">文件名稱：{form.name}</Typography>
        <Typography variant="helper">文件編號：{form.docNumber ?? '—'}</Typography>
        <Typography variant="helper">文件頁數：{pages} 頁</Typography>
      </Stack>
      <Typography variant="helper" component="div" sx={{ my: 3 }}>
        本人確認已閱讀並同意上述文件內容。
      </Typography>
      <Stack>
        <Typography variant="helper">簽署人：{signer.name}</Typography>
        <Typography variant="helper">員工編號：{signer.employeeNo}</Typography>
      </Stack>
    </>
  );
}

function FieldBox({
  field,
  signature,
  signatureId,
  dateText,
  onSign,
}: {
  field: UploadField;
  signature?: string;
  /** 簽名識別碼；有值時在欄位右下角顯示追蹤 QR code */
  signatureId?: string;
  dateText: string;
  onSign?: () => void;
}) {
  const position = {
    position: 'absolute',
    left: `${field.x}%`,
    top: `${field.y}%`,
    width: `${FIELD_W_PCT}%`,
    height: `${FIELD_H_PCT}%`,
    borderRadius: 1,
  } as const;

  if (field.type === 'date') {
    return (
      <Box
        sx={{ ...position, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: 1, borderColor: 'grey.400', borderRadius: 0 }}
      >
        <Typography variant="helper" sx={{ color: 'text.primary' }}>
          {dateText}
        </Typography>
      </Box>
    );
  }

  const content = signature ? (
    // 簽名在左、追蹤 QR code 在右下角，互不遮擋
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, width: '100%', height: '100%' }}>
      <Box
        component="img"
        src={signature}
        alt="你的簽名"
        sx={{ flex: 1, minWidth: 0, height: '100%', objectFit: 'contain' }}
      />
      {signatureId && (
        <Box sx={{ height: '72%' }}>
          <SignatureQr signatureId={signatureId} />
        </Box>
      )}
    </Box>
  ) : (
    <>
      <DrawRoundedIcon fontSize="small" />
      <Typography variant="helper" sx={{ color: 'inherit' }}>
        {onSign ? '點此簽名' : '未簽名'}
      </Typography>
    </>
  );

  const signedStyle = { border: 1, borderColor: 'transparent', bgcolor: 'transparent' };
  const pendingStyle = {
    border: 1.5,
    borderStyle: 'dashed',
    borderColor: 'warning.main',
    bgcolor: 'warning.less',
    color: 'warning.dark',
  };

  if (!onSign) {
    return (
      <Box sx={{ ...position, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, ...(signature ? signedStyle : pendingStyle) }}>
        {content}
      </Box>
    );
  }

  return (
    <Box
      component="button"
      type="button"
      onClick={onSign}
      aria-label={signature ? '重新簽名' : '簽名'}
      title={signature ? '點擊重新簽名' : undefined}
      sx={{
        ...position,
        p: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.5,
        cursor: 'pointer',
        font: 'inherit',
        ...(signature ? { ...signedStyle, '&:hover': { borderColor: 'primary.main', borderStyle: 'dashed' } } : pendingStyle),
      }}
    >
      {content}
    </Box>
  );
}

/** 文件逐頁預覽：縮圖標示需簽名的頁面，頁面上顯示簽名／日期欄位 */
export default function DocumentViewer({
  form,
  signer,
  layout,
  signatures,
  signatureIds = {},
  dateText,
  activePage,
  onPageChange,
  onSignField,
}: DocumentViewerProps) {
  const pages = Array.from({ length: layout.pageCount }, (_, i) => i + 1);
  const pageLabel = (p: number) => (p === layout.confirmPage ? '簽署確認頁' : `第 ${p} 頁`);
  const signPages = [...new Set(layout.fields.filter((f) => f.type === 'sign').map((f) => f.page))];
  const pageFields = layout.fields.filter((f) => f.page === activePage);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="secondary" component="div" sx={{ mb: 1 }}>
          需簽名的頁面：{signPages.map(pageLabel).join('、')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1 }}>
          {pages.map((p) => {
            const signs = layout.fields.filter((f) => f.page === p && f.type === 'sign');
            return (
              <PageThumb
                key={p}
                label={pageLabel(p)}
                active={p === activePage}
                signCount={signs.length}
                signedCount={signs.filter((f) => signatures[f.id]).length}
                onClick={() => onPageChange(p)}
              />
            );
          })}
        </Box>
      </Box>

      <Box
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: 460,
          aspectRatio: '210 / 297',
          mx: 'auto',
          px: 3,
          py: 4,
          overflow: 'hidden',
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'grey.300',
          borderRadius: 1,
          boxShadow: 2,
        }}
      >
        {activePage === layout.confirmPage ? (
          <ConfirmPageContent form={form} signer={signer} pages={layout.originalPages} />
        ) : (
          <OriginalPageContent page={activePage} isLast={activePage === layout.originalPages} />
        )}
        {pageFields.map((f) => (
          <FieldBox
            key={f.id}
            field={f}
            signature={signatures[f.id]}
            signatureId={signatureIds[f.id]}
            dateText={dateText}
            onSign={onSignField && (() => onSignField(f))}
          />
        ))}
      </Box>
    </Stack>
  );
}
