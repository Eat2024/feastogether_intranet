'use client';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';
import { exportPageHref, FIELDS, STATUS_OPTIONS, type ExportQuery, type FieldKey } from './exportQuery';
import type { Signer } from '../types';
import type { DeptNode } from './deptTree';
import DeptTreeSelect from './DeptTreeSelect';

const CONTENT_TYPES = [
  { key: 'list', label: '簽署紀錄清單（Excel）', description: '每位簽署人一列，可選擇欄位與範圍。', enabled: true },
  { key: 'docs', label: '已簽署文件（PDF，每人一份打包為 ZIP）', description: '需後端支援，之後提供。', enabled: false },
];

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subheading" component="div" sx={{ mb: 1 }}>
        {step}. {title}
      </Typography>
      {children}
    </Box>
  );
}

/** 匯出條件：變更時寫入網址，由伺服器重新產生預覽 */
export default function ExportOptions({
  formId,
  query,
  deptTree,
}: {
  formId: string;
  query: ExportQuery;
  /** 此文件簽署人所屬的部門樹 */
  deptTree: DeptNode[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const update = (change: Partial<ExportQuery>) =>
    startTransition(() => router.replace(exportPageHref(formId, { ...query, ...change }), { scroll: false }));

  const allStatuses = query.statuses.length === 0;
  const toggleStatus = (key: Signer['status']) => {
    const next = query.statuses.includes(key) ? query.statuses.filter((s) => s !== key) : [...query.statuses, key];
    // 三種都勾等同全部
    update({ statuses: next.length === STATUS_OPTIONS.length ? [] : next });
  };
  const toggleField = (key: FieldKey) => {
    const next = query.fields.includes(key) ? query.fields.filter((f) => f !== key) : [...query.fields, key];
    if (next.length === 0) return; // 至少保留一個欄位
    update({ fields: FIELDS.filter((f) => next.includes(f.key)).map((f) => f.key) });
  };

  return (
    <Stack spacing={3}>
      <Section step={1} title="選擇匯出內容">
        <RadioGroup value="list">
          {CONTENT_TYPES.map((t) => (
            <FormControlLabel
              key={t.key}
              value={t.key}
              disabled={!t.enabled}
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="content" component="span">
                    {t.label}
                  </Typography>{' '}
                  <Typography variant="helper">{t.description}</Typography>
                </Box>
              }
            />
          ))}
        </RadioGroup>
      </Section>

      <Section step={2} title="匯出範圍">
        <Stack spacing={1.5}>
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
            <Typography variant="label" component="span" sx={{ width: 72 }}>
              簽署狀態
            </Typography>
            <FormControlLabel
              control={<Checkbox size="small" checked={allStatuses} onChange={() => update({ statuses: [] })} />}
              label={<Typography variant="content">全部</Typography>}
            />
            {STATUS_OPTIONS.map((o) => (
              <FormControlLabel
                key={o.key}
                control={
                  <Checkbox
                    size="small"
                    checked={!allStatuses && query.statuses.includes(o.key)}
                    onChange={() => toggleStatus(o.key)}
                  />
                }
                label={<Typography variant="content">{o.label}</Typography>}
              />
            ))}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', columnGap: 1 }}>
            <Typography variant="label" component="span" sx={{ width: 72, flexShrink: 0, pt: 1.25 }}>
              部門
            </Typography>
            <DeptTreeSelect tree={deptTree} value={query.depts} onChange={(depts) => update({ depts })} />
          </Box>
        </Stack>
      </Section>

      <Section step={3} title="匯出欄位">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
          {FIELDS.map((f) => (
            <FormControlLabel
              key={f.key}
              control={
                <Checkbox size="small" checked={query.fields.includes(f.key)} onChange={() => toggleField(f.key)} />
              }
              label={<Typography variant="content">{f.label}</Typography>}
            />
          ))}
        </Box>
      </Section>
    </Stack>
  );
}
