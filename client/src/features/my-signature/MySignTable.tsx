import SortableHeaderCell from '@/components/SortableHeaderCell';
import SignProgressButton from './MySignProgressDialog';
import { nextSortState } from '@/lib/tableSort';
import { FORM_STATUS_META } from '@/features/forms/status';
import Box from '@mui/material/Box';
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
import SignActionButton from './SignActionButton';
import DownloadSignedCopyButton from './sign/DownloadSignedCopyButton';
import { mySignHref, type MySortKey, type MySortState } from './sort';
import { daysUntil, type MySignTab, type MySignTask } from './tasks';

// 剩餘天數 ≤ 此值時標示「即將到期」
const DUE_SOON_DAYS = 3;

function DueDate({ date, today }: { date: string | null; today: Date }) {
  // 待簽署的文件都已發起，未設結束日即不限期
  if (!date) return <>不限</>;
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
  /** 提供時此欄可排序 */
  sortKey?: MySortKey;
  cell: (task: MySignTask) => ReactNode;
  nowrap?: boolean;
};

const EMPTY_TEXT: Record<MySignTab, string> = {
  pending: '目前沒有待簽署的文件。',
  signed: '目前沒有已簽署的文件。',
  rejected: '目前沒有已拒絕的文件。',
};

/** tasks 需已依 sort 排序（排序在伺服器端完成） */
export default function MySignTable({
  tab,
  tasks,
  today,
  sort,
}: {
  tab: MySignTab;
  tasks: MySignTask[];
  today: Date;
  sort: MySortState;
}) {
  // 三個分頁共用的前兩欄：文件名稱、文件編號
  const common: Column[] = [
    {
      header: '文件名稱',
      sortKey: 'name',
      cell: ({ form }) => form.name,
    },
    {
      header: '文件編號',
      sortKey: 'docNumber',
      nowrap: true,
      cell: ({ form }) => form.docNumber ?? '—',
    },
  ];

  // 發起人一律放在「操作」左邊
  const initiator: Column = {
    header: '發起人',
      sortKey: 'initiator',
    nowrap: true,
    cell: ({ form }) => (
      <>
        <Typography variant="content">{form.createdBy.name}</Typography>
        <Typography variant="helper">{form.createdBy.employeeNo}</Typography>
      </>
    ),
  };

  const viewAction: Column = {
    header: '操作',
    cell: ({ form, me, progress }) => <SignProgressButton form={form} me={me} progress={progress} />,
  };

  const columnsByTab: Record<MySignTab, Column[]> = {
    pending: [
      ...common,
      { header: '開始時間',
      sortKey: 'startAt', nowrap: true, cell: ({ form }) => form.startAt },
      { header: '結束時間',
      sortKey: 'endAt', nowrap: true, cell: ({ form }) => <DueDate date={form.endAt} today={today} /> },
      initiator,
      {
        header: '操作',
        // 已逾期或尚未開始時停用
        cell: ({ form, signBlock }) => <SignActionButton formId={form.id} disabled={signBlock !== null} />,
      },
    ],
    signed: [
      ...common,
      { header: '簽署時間',
      sortKey: 'signedAt', nowrap: true, cell: ({ me }) => me.signedAt },
      {
        header: '文件狀態',
      sortKey: 'status',
        cell: ({ progress }) => {
          const status = FORM_STATUS_META[progress.status];
          return <Chip size="small" variant="soft" label={status.label} color={status.color} />;
        },
      },
      initiator,
      {
        header: '操作',
        cell: ({ form, me, progress }) => (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <SignProgressButton form={form} me={me} progress={progress} />
            <DownloadSignedCopyButton form={form} me={me} variant="icon" />
          </Box>
        ),
      },
    ],
    rejected: [
      ...common,
      { header: '拒絕時間',
      sortKey: 'rejectedAt', nowrap: true, cell: ({ me }) => me.rejectedAt },
      {
        header: '拒絕原因',
      sortKey: 'rejectReason',
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
      initiator,
      viewAction,
    ],
  };

  const columns = columnsByTab[tab];

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table>
        <TableHead>
          <TableRow>
            {columns.map((col) =>
              col.sortKey ? (
                <SortableHeaderCell
                  key={col.header}
                  active={sort?.key === col.sortKey}
                  order={sort?.order ?? 'asc'}
                  href={mySignHref(tab, nextSortState(sort, col.sortKey))}
                >
                  {col.header}
                </SortableHeaderCell>
              ) : (
                <TableCell key={col.header}>{col.header}</TableCell>
              ),
            )}
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
