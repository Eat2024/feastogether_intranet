'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { SIGN_TERMS, SIGN_TERMS_VERSION } from './terms';

// 距離底部多少 px 內視為已讀到底（避免小數像素差）
const BOTTOM_TOLERANCE = 4;

/** 流程第一步：閱讀電子簽名使用條款，捲動到底部後才能勾選同意 */
export default function TermsStep({
  docName,
  onAgree,
}: {
  docName: string;
  onAgree: () => void;
}) {
  const [reachedBottom, setReachedBottom] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const checkBottom = (el: HTMLElement) => {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_TOLERANCE)
      setReachedBottom(true);
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Stack spacing={1}>
          <Typography variant="sectionTitle">電子簽名使用條款</Typography>
          <Typography variant="description">
            簽署「{docName}
            」前，請詳閱以下條款並捲動至最下方，同意後才能開始閱讀與簽署文件。
          </Typography>
        </Stack>

        <Box
          // 內容不足以捲動時，掛載後即視為已讀到底
          ref={(el: HTMLDivElement | null) => {
            if (el) checkBottom(el);
          }}
          onScroll={(e) => checkBottom(e.currentTarget)}
          tabIndex={0}
          aria-label="電子簽名使用條款全文"
          sx={{
            // 固定較矮的高度，讓使用者須捲動閱讀；內容不足以捲動時直接視為已讀完
            maxHeight: 200,
            overflowY: 'auto',
            px: 3,
            py: 2,
            bgcolor: 'grey.100',
            border: 1,
            borderColor: 'formBorder',
            borderRadius: 1,
          }}
        >
          <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
            {SIGN_TERMS.map((term) => (
              <Typography
                key={term}
                component="li"
                variant="content"
                sx={{ mb: 1.5, display: 'list-item' }}
              >
                {term}
              </Typography>
            ))}
          </Box>
          <Typography variant="helper" component="div" sx={{ mt: 2 }}>
            — 條款結束 —
          </Typography>
        </Box>
        <Typography variant="helper">條款版本：{SIGN_TERMS_VERSION}</Typography>

        <Box>
          <FormControlLabel
            disabled={!reachedBottom}
            control={
              <Checkbox
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
            }
            label={
              <Typography variant="content">
                我已詳閱並同意上述電子簽名使用條款
              </Typography>
            }
          />
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button size="large" variant="outlined" href="/my-signature">
            不同意，返回
          </Button>
          <Button
            size="large"
            variant="contained"
            disabled={!agreed}
            onClick={onAgree}
          >
            同意並繼續
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}
