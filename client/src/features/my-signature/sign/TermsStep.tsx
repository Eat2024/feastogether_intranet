'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

// 距離底部多少 px 內視為已讀到底（避免小數像素差）
const BOTTOM_TOLERANCE = 4;

/** terms：內部員工的電子簽名使用條款；consent：外部簽署人的電子簽署同意聲明（後端目前有效的版本） */
const COPY = {
  terms: {
    title: '電子簽名使用條款',
    guide: '請詳閱以下條款並捲動至最下方',
    end: '— 條款結束 —',
    version: '條款版本',
    agree: '我已詳閱並同意上述電子簽名使用條款',
  },
  consent: {
    title: '電子簽署同意聲明',
    guide: '請詳閱以下聲明',
    end: null,
    version: '聲明版本',
    agree: '我已詳閱並同意上述聲明',
  },
};

/** 流程第一步：閱讀電子簽名使用條款（或同意聲明），捲動到底部後才能勾選同意 */
export default function TermsStep({
  docName,
  terms,
  version,
  kind = 'terms',
  backHref,
  onAgree,
}: {
  docName: string;
  /** 條款全文；只有一段時不編號 */
  terms: readonly string[];
  /** 顯示的條款版本 */
  version: string;
  /** 文案類型，見 COPY */
  kind?: keyof typeof COPY;
  /** 「不同意，返回」的連結；未提供時不顯示此按鈕 */
  backHref?: string;
  onAgree: () => void;
}) {
  const copy = COPY[kind];
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
          <Typography variant="sectionTitle">{copy.title}</Typography>
          <Typography variant="description">
            簽署「{docName}
            」前，{copy.guide}，同意後才能開始閱讀與簽署文件。
          </Typography>
        </Stack>

        <Box
          // 內容不足以捲動時，掛載後即視為已讀到底
          ref={(el: HTMLDivElement | null) => {
            if (el) checkBottom(el);
          }}
          onScroll={(e) => checkBottom(e.currentTarget)}
          tabIndex={0}
          aria-label={`${copy.title}全文`}
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
          {terms.length === 1 ? (
            <Typography variant="content" component="p" sx={{ m: 0 }}>
              {terms[0]}
            </Typography>
          ) : (
            <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
              {terms.map((term) => (
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
          )}
          {copy.end && (
            <Typography variant="helper" component="div" sx={{ mt: 2 }}>
              {copy.end}
            </Typography>
          )}
        </Box>
        <Typography variant="helper">
          {copy.version}：{version}
        </Typography>

        <Box>
          <FormControlLabel
            disabled={!reachedBottom}
            control={
              <Checkbox
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
            }
            label={<Typography variant="content">{copy.agree}</Typography>}
          />
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          {backHref && (
            <Button size="large" variant="outlined" href={backHref}>
              不同意，返回
            </Button>
          )}
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
