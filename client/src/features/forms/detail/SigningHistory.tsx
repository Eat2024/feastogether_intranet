import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { toTaipeiDateTime } from '@/lib/dates';

/** 後端回傳的簽署歷程（已依檢視者身分裁切） */
export type HistoryItem = {
  type: string;
  occurredAt: string;
  /** 建立人、本人或系統 */
  actor: string | null;
  reason: string | null;
};

const EVENT_LABEL: Record<string, string> = {
  'document.created': '建立文件',
  'document.draft_updated': '修改草稿',
  'signer.assigned': '指派簽署人',
  'document.initiated': '發起簽署',
  'external_invitation.opened': '開啟邀請連結',
  'document.opened': '開啟文件',
  'consent.accepted': '同意電子簽名告知',
  'signature.submitted': '送出簽名',
  'signature.completed': '完成簽署',
  'document.completed': '文件完成',
  'document.finalization_failed': '產生完成文件失敗',
  'document.stopped_by_creator': '建立人停止簽署',
  'document.stopped_by_deadline': '到期自動停止',
};

/** 簽署歷程（時間由舊到新） */
export default function SigningHistory({ items }: { items: HistoryItem[] }) {
  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Typography variant="sectionTitle">簽署歷程</Typography>
        {items.length === 0 ? (
          <Typography variant="secondary">尚無紀錄</Typography>
        ) : (
          <Stack component="ol" spacing={1} sx={{ m: 0, pl: 0, listStyle: 'none' }}>
            {items.map((item, index) => (
              <Stack
                key={`${item.occurredAt}-${item.type}-${index}`}
                component="li"
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 0, sm: 2 }}
              >
                <Typography variant="secondary" sx={{ whiteSpace: 'nowrap', minWidth: 140 }}>
                  {toTaipeiDateTime(new Date(item.occurredAt))}
                </Typography>
                <Typography variant="content">
                  {EVENT_LABEL[item.type] ?? item.type}
                  {item.actor && `（${item.actor}）`}
                  {item.reason && `：${item.reason}`}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
