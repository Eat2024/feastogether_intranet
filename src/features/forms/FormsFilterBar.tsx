'use client';

// 列表篩選：文件狀態（多選）與簽署期間（起訖日）。條件寫入網址參數，由伺服器端篩選；
// 會保留其他參數（搜尋關鍵字、排序）。
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { zhTW } from '@mui/x-date-pickers/locales';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-tw';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { FORM_STATUS_META } from './status';
import { FORM_STATUSES } from './sort';
import type { FormStatus } from './types';

// 網址上的日期格式
const PARAM_FORMAT = 'YYYY-MM-DD';

export default function FormsFilterBar({
  statuses,
  from,
  to,
}: {
  statuses: FormStatus[];
  from: string | null;
  to: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const update = (next: Partial<{ status: string | null; from: string | null; to: string | null }>) => {
    const qs = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) qs.set(key, value);
      else qs.delete(key);
    }
    // 篩選條件改變時回到第 1 頁
    qs.delete('page');
    const s = qs.toString();
    startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };

  // 只在日期完整且有效時才更新（手動輸入到一半不觸發）
  const onDate = (key: 'from' | 'to') => (v: Dayjs | null) => {
    if (v === null) update({ [key]: null });
    else if (v.isValid()) update({ [key]: v.format(PARAM_FORMAT) });
  };

  const fromVal = from ? dayjs(from) : null;
  const toVal = to ? dayjs(to) : null;
  const dateSlotProps = {
    textField: { size: 'small' as const, sx: { width: 188, bgcolor: 'background.paper' } },
    field: { clearable: true },
  };

  return (
    <LocalizationProvider
      dateAdapter={AdapterDayjs}
      adapterLocale="zh-tw"
      localeText={zhTW.components.MuiLocalizationProvider.defaultProps.localeText}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <Select
          size="small"
          multiple
          displayEmpty
          value={statuses}
          onChange={(e) => {
            const v = e.target.value;
            const picked = typeof v === 'string' ? v.split(',') : v;
            update({ status: FORM_STATUSES.filter((s) => picked.includes(s)).join(',') || null });
          }}
          renderValue={(sel) =>
            sel.length === 0 ? '全部狀態' : sel.map((s) => FORM_STATUS_META[s].label).join('、')
          }
          inputProps={{ 'aria-label': '文件狀態' }}
          sx={{ width: 160, bgcolor: 'background.paper' }}
        >
          {FORM_STATUSES.map((s) => (
            <MenuItem key={s} value={s} dense>
              <Checkbox size="small" checked={statuses.includes(s)} sx={{ p: 0.5, mr: 1 }} />
              <ListItemText primary={FORM_STATUS_META[s].label} />
            </MenuItem>
          ))}
        </Select>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DatePicker
            value={fromVal}
            maxDate={toVal ?? undefined}
            onChange={onDate('from')}
            label="開始時間"
            format="YYYY/MM/DD"
            slotProps={dateSlotProps}
          />
          <Typography variant="secondary" component="span">
            ～
          </Typography>
          <DatePicker
            value={toVal}
            minDate={fromVal ?? undefined}
            onChange={onDate('to')}
            label="結束時間"
            format="YYYY/MM/DD"
            slotProps={dateSlotProps}
          />
        </Box>

        {(statuses.length > 0 || from || to) && (
          <Button size="small" onClick={() => update({ status: null, from: null, to: null })}>
            清除篩選
          </Button>
        )}
      </Box>
    </LocalizationProvider>
  );
}
