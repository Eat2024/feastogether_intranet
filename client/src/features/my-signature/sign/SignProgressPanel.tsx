'use client';

import { signFieldLabel, signFields, type SignLayout } from '@/features/forms/signLayout';
import type { UploadField } from '@/features/forms/types';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
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

type SignProgressPanelProps = {
  layout: SignLayout;
  /** 欄位 id → 手寫簽名 PNG */
  signatures: Record<number, string>;
  readAgreed: boolean;
  onReadAgreedChange: (agreed: boolean) => void;
  /** 送出中：停用所有操作 */
  busy: boolean;
  onFieldClick: (field: UploadField) => void;
  onConfirm: () => void;
  /** 提供時顯示「拒絕簽署」 */
  onReject?: () => void;
  /** 沒有 onReject 時，提供此說明則仍顯示停用的「拒絕簽署」並標示原因（例如後端尚未支援） */
  rejectUnavailable?: string;
  /**
   * 手機寬度固定在畫面底部，只顯示簽名進度、同意勾選與確認簽署；
   * 呼叫端須為頁面內容保留底部空間，避免遮住文件。
   */
  fixedOnMobile?: boolean;
};

/** 簽署面板：簽名進度、同意文件內容與確認簽署；桌面寬度捲動文件時固定在畫面上 */
export default function SignProgressPanel({
  layout,
  signatures,
  readAgreed,
  onReadAgreedChange,
  busy,
  onFieldClick,
  onConfirm,
  onReject,
  rejectUnavailable,
  fixedOnMobile = false,
}: SignProgressPanelProps) {
  const fields = signFields(layout);
  const signedCount = fields.filter((f) => signatures[f.id]).length;
  const allSigned = signedCount === fields.length;
  const ready = readAgreed && allSigned;
  // 固定在底部時，手機寬度只保留進度、同意勾選與按鈕；md 以上與一般面板相同
  const desktopOnly = fixedOnMobile ? { display: { xs: 'none', md: 'block' } } : undefined;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        borderRadius: 2,
        position: { md: 'sticky' },
        top: { md: 24 },
        ...(fixedOnMobile && {
          position: { xs: 'fixed', md: 'sticky' },
          left: { xs: 0, md: 'auto' },
          right: { xs: 0, md: 'auto' },
          bottom: { xs: 0, md: 'auto' },
          zIndex: { xs: 'appBar', md: 'auto' },
          px: { xs: 2, md: 2.5 },
          pt: { xs: 1.5, md: 2.5 },
          pb: { xs: 2, md: 2.5 },
          borderRadius: { xs: 0, md: 2 },
          borderWidth: { xs: '1px 0 0', md: '1px' },
        }),
      }}
    >
      <Stack spacing={fixedOnMobile ? { xs: 1, md: 2 } : 2}>
        <Box>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 1,
              mb: fixedOnMobile ? { xs: 0, md: 1 } : 1,
            }}
          >
            <Typography variant="subheading" component="div">
              簽名進度
            </Typography>
            <Typography variant="secondary" component="span" sx={fixedOnMobile ? { mr: { xs: 'auto', md: 0 } } : undefined}>
              {signedCount}/{fields.length}
            </Typography>
            {fixedOnMobile && (
              <Chip
                size="small"
                variant="soft"
                color={allSigned ? 'success' : 'warning'}
                label={allSigned ? '已簽名' : '待簽名'}
                sx={{ display: { md: 'none' } }}
              />
            )}
          </Box>
          <Box sx={desktopOnly}>
            <List disablePadding sx={{ border: 1, borderColor: 'formBorder', borderRadius: 1, overflow: 'hidden' }}>
              {fields.map((f, i) => {
                const done = !!signatures[f.id];
                return (
                  <ListItemButton
                    key={f.id}
                    divider={i < fields.length - 1}
                    onClick={() => onFieldClick(f)}
                    disabled={busy}
                    sx={{ gap: 1, py: 1 }}
                  >
                    {done ? (
                      <CheckCircleRoundedIcon fontSize="small" sx={{ color: 'success.main' }} />
                    ) : (
                      <DrawRoundedIcon fontSize="small" sx={{ color: 'warning.dark' }} />
                    )}
                    <Typography variant="content" component="span" sx={{ flex: 1 }}>
                      {signFieldLabel(layout, f)}
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
        </Box>

        <Divider sx={desktopOnly} />

        <FormControlLabel
          disabled={busy}
          control={<Checkbox checked={readAgreed} onChange={(e) => onReadAgreedChange(e.target.checked)} />}
          label={<Typography variant="content">我已閱讀並同意上述文件內容</Typography>}
        />

        <Stack spacing={1}>
          <Button size="large" variant="contained" fullWidth disabled={!ready || busy} onClick={onConfirm}>
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
          {onReject && (
            <Button size="large" variant="outlined" color="error" fullWidth disabled={busy} onClick={onReject}>
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
  );
}
