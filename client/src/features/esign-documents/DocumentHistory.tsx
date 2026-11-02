'use client';

// 檢視頁的簽署歷程：GET /api/esign/documents/:id/history，依時間由新到舊顯示
import { useGetDocumentHistoryQuery } from '@/api/queries';
import type { EsignHistoryItem } from '@/api/types';
import { getErrorMessage } from '@/lib/apiError';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import dayjs from 'dayjs';

/** 需要特別標示的事件 */
const EVENT_COLOR: Record<string, string> = {
  'document.completed': 'success.dark',
  'document.expired': 'info.dark',
  'document.stopped_by_creator': 'error.dark',
  'document.stopped_by_deadline': 'error.dark',
};

/**
 * 合併同一秒、同類型、同操作者且沒有原因的連續事件（例如發起時每位簽署人各一筆「指派簽署人」），
 * 只有相同身分的事件才合併；同名簽署人仍依公開識別區分。
 */
function groupEvents(events: EsignHistoryItem[]) {
  const groups: (EsignHistoryItem & { count: number })[] = [];
  for (const e of events) {
    const last = groups.at(-1);
    const sameSecond = last && dayjs(last.occurredAt).isSame(e.occurredAt, 'second');
    const sameActor =
      last &&
      last.actor.kind === e.actor.kind &&
      last.actor.name === e.actor.name &&
      last.actor.signerPublicId === e.actor.signerPublicId;
    if (last && sameSecond && sameActor && last.type === e.type && !last.reason && !e.reason) {
      last.count += 1;
    } else {
      groups.push({ ...e, count: 1 });
    }
  }
  return groups;
}

export default function DocumentHistory({ documentId }: { documentId: string }) {
  const { data, isPending, isError, error, refetch, isFetching } = useGetDocumentHistoryQuery(documentId);
  // 最新的事件在上面
  const events = data ? groupEvents([...data].reverse()) : [];

  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <Typography variant="sectionTitle" component="h2" sx={{ mb: 2 }}>
        簽署歷程
      </Typography>
      {isPending ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
          <CircularProgress size={18} />
          <Typography variant="description">載入簽署歷程中…</Typography>
        </Box>
      ) : isError ? (
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="description">無法取得簽署歷程：{getErrorMessage(error)}</Typography>
          <Button variant="outlined" onClick={() => refetch()} loading={isFetching}>
            重新載入
          </Button>
        </Stack>
      ) : events.length === 0 ? (
        <Typography variant="description">目前沒有任何紀錄。</Typography>
      ) : (
        <Stack component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {events.map((e, i) => (
            <Box
              component="li"
              key={`${e.occurredAt}-${e.type}-${i}`}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '150px 1fr' },
                columnGap: 2,
                rowGap: 0.25,
                py: 1.25,
                borderTop: i === 0 ? 0 : 1,
                borderColor: 'divider',
              }}
            >
              <Typography variant="secondary" component="div" sx={{ whiteSpace: 'nowrap' }}>
                {dayjs(e.occurredAt).format('YYYY/MM/DD HH:mm:ss')}
              </Typography>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="content"
                  component="div"
                  sx={EVENT_COLOR[e.type] ? { color: EVENT_COLOR[e.type] } : undefined}
                >
                  {e.label}
                  {e.count > 1 && `（${e.count} 筆）`}
                  <Typography variant="helper" component="span" sx={{ ml: 1 }}>
                    {e.actor.name}
                  </Typography>
                </Typography>
                {e.reason && (
                  <Typography variant="helper" component="div" sx={{ overflowWrap: 'anywhere' }}>
                    原因：{e.reason}
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
