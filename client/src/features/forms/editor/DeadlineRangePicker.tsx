'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { zhTW } from '@mui/x-date-pickers/locales';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-tw';

// 資料格式 YYYY/MM/DD
const FORMAT = 'YYYY/MM/DD';
// 轉成 ISO（YYYY-MM-DD）再解析，不需載入 customParseFormat 外掛
const toDayjs = (v: string | null) => (v ? dayjs(v.replaceAll('/', '-')) : null);

/* 免費版 MUI X 沒有區間日曆（DateRangeCalendar 屬於付費 Pro 版），
   以兩個 DateCalendar（開始日／結束日）組成起訖區間 */
export default function DeadlineRangePicker({
  start,
  end,
  onChange,
}: {
  start: string | null;
  end: string | null;
  onChange: (range: { start: string | null; end: string | null }) => void;
}) {
  const startVal = toDayjs(start);
  const endVal = toDayjs(end);

  return (
    // adapterLocale 只影響日期格式；按鈕與 aria 文字需另外指定 localeText
    <LocalizationProvider
      dateAdapter={AdapterDayjs}
      adapterLocale="zh-tw"
      localeText={zhTW.components.MuiLocalizationProvider.defaultProps.localeText}
    >
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="label" component="div" sx={{ mb: 1 }}>
            開始日
          </Typography>
          <Box sx={{ border: 1, borderColor: 'formBorder', borderRadius: 1 }}>
            <DateCalendar
              value={startVal}
              onChange={(v) => {
                const next = v ? v.format(FORMAT) : null;
                // 開始日晚於結束日時清除結束日
                const endStillValid = !v || !endVal || !endVal.isBefore(v, 'day');
                onChange({ start: next, end: endStillValid ? end : null });
              }}
            />
          </Box>
        </Box>
        <Box>
          <Typography variant="label" component="div" sx={{ mb: 1 }}>
            結束日
          </Typography>
          <Box sx={{ border: 1, borderColor: 'formBorder', borderRadius: 1 }}>
            <DateCalendar
              value={endVal}
              minDate={startVal ?? undefined}
              onChange={(v) => onChange({ start, end: v ? v.format(FORMAT) : null })}
            />
          </Box>
        </Box>
      </Box>
    </LocalizationProvider>
  );
}
