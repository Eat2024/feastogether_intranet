import SignProgressButton from '@/features/forms/SignProgressDialog';
import { FORM_STATUS_META, deriveStatus } from '@/features/forms/status';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import DownloadSignedCopyButton from './sign/DownloadSignedCopyButton';
import { getSignBlock } from './sign/eligibility';
import { daysUntil, type MySignTab, type MySignTask } from './tasks';

// 剩餘天數 ≤ 此值時標示「即將到期」
const DUE_SOON_DAYS = 3;

function DueDate({ date, today }: { date: string | null; today: Date }) {
  if (!date) return <>—</>;
  const days = daysUntil(date, today);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {date}
      {days < 0 && <Chip size="small" variant="soft" color="error" label="已逾期" />}
      {days >= 0 && days <= DUE_SOON_DAYS && (
        <Chip size="small" variant="soft" color="warning" label="即將到期" />
      )}
    </Box>
  );
}

type Column = {
  header: string;
  cell: (task: MySignTask) => ReactNode;
  nowrap?: boolean;
};

const EMPTY_TEXT: Record<MySignTab, string> = {
  pending: '目前沒有待簽署的文件。',
  signed: '目前沒有已簽署的文件。',
  rejected: '目前沒有已拒絕的文件。',
};

export default function MySignTable({
  tab,
  tasks,
  today,
}: {
  tab: MySignTab;
  tasks: MySignTask[];
  today: Date;
}) {
  // 三個分頁共用的前兩欄
  const common: Column[] = [
    {
      header: '文件名稱',
      cell: ({ form }) => (
        <>
          <Typography variant="content">{form.name}</Typography>
          {form.docNumber && <Typography variant="helper">{form.docNumber}</Typography>}
        </>
      ),
    },
    {
      header: '發起人',
      nowrap: true,
      cell: ({ form }) => (
        <>
          <Typography variant="content">{form.createdBy.name}</Typography>
          <Typography variant="helper">{form.createdBy.employeeNo}</Typography>
        </>
      ),
    },
  ];

  const viewAction: Column = {
    header: '操作',
    cell: ({ form }) => <SignProgressButton form={form} />,
  };

  const columnsByTab: Record<MySignTab, Column[]> = {
    pending: [
      ...common,
      { header: '發起日期', nowrap: true, cell: ({ form }) => form.startAt },
      { header: '簽署期限', nowrap: true, cell: ({ form }) => <DueDate date={form.endAt} today={today} /> },
      {
        header: '操作',
        // 已逾期或尚未開始時停用
        cell: ({ form, me }) => (
          <Button
            size="small"
            variant="contained"
            href={`/my-signature/${form.id}`}
            disabled={getSignBlock(form, me, today) !== null}
          >
            簽署
          </Button>
        ),
      },
    ],
    signed: [
      ...common,
      { header: '簽署時間', nowrap: true, cell: ({ me }) => me.signedAt },
      {
        header: '文件狀態',
        cell: ({ form }) => {
          const status = FORM_STATUS_META[deriveStatus(form)];
          return <Chip size="small" variant="soft" label={status.label} color={status.color} />;
        },
      },
      {
        header: '操作',
        cell: ({ form, me }) => (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <SignProgressButton form={form} />
            <DownloadSignedCopyButton form={form} me={me} variant="icon" />
          </Box>
        ),
      },
    ],
    rejected: [
      ...common,
      { header: '拒絕時間', nowrap: true, cell: ({ me }) => me.rejectedAt },
      {
        header: '拒絕原因',
        // 完整顯示、自動換行；保留最小寬度避免被擠成過窄的一欄
        cell: ({ me }) =>
          me.rejectReason ? (
            <Typography variant="content" sx={{ minWidth: 240, overflowWrap: 'anywhere' }}>
              {me.rejectReason}
            </Typography>
          ) : (
            '—'
          ),
      },
      viewAction,
    ],
  };

  const columns = columnsByTab[tab];

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell key={col.header}>{col.header}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} align="center" sx={{ py: 6 }}>
                <Typography variant="description">{EMPTY_TEXT[tab]}</Typography>
              </TableCell>
            </TableRow>
          ) : (
            tasks.map((task) => (
              <TableRow key={task.form.id} hover>
                {columns.map((col) => (
                  <TableCell key={col.header} sx={col.nowrap ? { whiteSpace: 'nowrap' } : undefined}>
                    {col.cell(task)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
