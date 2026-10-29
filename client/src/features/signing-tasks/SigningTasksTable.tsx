'use client';

// 我的電子簽（後端資料）的表格；欄位與 mock 版 MySignTable 相同。
import type { EsignSigningTask } from '@/api/types';
import SortableHeaderCell from '@/components/SortableHeaderCell';
import TooltipIconButton from '@/components/TooltipIconButton';
import { DOCUMENT_STATUS_META, formatDate, formatDateTime } from '@/features/esign-documents/listQuery';
import { daysUntil } from '@/lib/dates';
import { nextSortState } from '@/lib/tableSort';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
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
import {
  signingHref,
  SORT_KEYS_BY_TAB,
  type SigningSort,
  type SigningSortKey,
  type SigningTab,
} from './taskQuery';

// 剩餘天數 ≤ 此值時標示「即將到期」
const DUE_SOON_DAYS = 3;

function DueDate({ task, now }: { task: EsignSigningTask; now: Date }) {
  const { signEndAt, isReopened, status } = task.document;
  // 待簽署的文件都已發起，未設結束時間即不限期
  if (!signEndAt) return <>不限</>;
  const date = formatDate(signEndAt) ?? '';
  const days = daysUntil(date, now);
  const overdue = status === 'expired' || now >= new Date(signEndAt);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {date}
      {isReopened && <Chip size="small" variant="soft" color="info" label="補簽" />}
      {overdue && <Chip size="small" variant="soft" color="error" label="已逾期" />}
      {!overdue && days <= DUE_SOON_DAYS && <Chip size="small" variant="soft" color="warning" label="即將到期" />}
    </Box>
  );
}

type Column = {
  header: string;
  /** 提供時此欄可排序 */
  sortKey?: SigningSortKey;
  cell: (task: EsignSigningTask) => ReactNode;
  nowrap?: boolean;
};

/** tasks 需已依 sort 排序、分頁；placeholder 為沒有資料列時顯示的內容（載入中、錯誤或空列表） */
export default function SigningTasksTable({
  tab,
  tasks,
  sort,
  now,
  placeholder,
}: {
  tab: SigningTab;
  tasks: EsignSigningTask[];
  sort: SigningSort;
  now: Date;
  placeholder: ReactNode;
}) {
  // 兩個分頁共用的前兩欄：文件名稱、文件編號
  const common: Column[] = [
    { header: '文件名稱', sortKey: 'name', cell: ({ document }) => document.title },
    { header: '文件編號', sortKey: 'docNumber', nowrap: true, cell: ({ document }) => document.docNumber },
  ];

  // 建立人一律放在「操作」左邊
  const initiator: Column = {
    header: '建立人',
    sortKey: 'initiator',
    nowrap: true,
    cell: ({ document }) =>
      document.createdBy ? (
        <>
          <Typography variant="content">{document.createdBy.name}</Typography>
          <Typography variant="helper">{document.createdBy.employeeNo}</Typography>
        </>
      ) : (
        '—'
      ),
  };

  const columnsByTab: Record<SigningTab, Column[]> = {
    pending: [
      ...common,
      {
        header: '開始時間',
        sortKey: 'startAt',
        nowrap: true,
        cell: ({ document }) => formatDate(document.signStartAt) ?? '—',
      },
      { header: '結束時間', sortKey: 'endAt', nowrap: true, cell: (task) => <DueDate task={task} now={now} /> },
      initiator,
      {
        header: '操作',
        // 以員工本人 session 進入閱讀與簽署。
        cell: (task) => (
          <TooltipIconButton
            label="前往簽署"
            icon={<VisibilityRoundedIcon />}
            color="info"
            href={`/my-signature/${task.signerPublicId}`}
          />
        ),
      },
    ],
    signed: [
      ...common,
      {
        header: '簽署時間',
        sortKey: 'signedAt',
        nowrap: true,
        cell: ({ signer }) => formatDateTime(signer.signedAt) ?? '—',
      },
      {
        header: '文件狀態',
        sortKey: 'status',
        cell: ({ document }) => {
          const status = DOCUMENT_STATUS_META[document.status];
          return <Chip size="small" variant="soft" label={status.label} color={status.color} />;
        },
      },
      initiator,
      {
        header: '操作',
        cell: (task) => (
          // 檢視簽署結果、簽章驗證與本人副本。
          <TooltipIconButton
            label="檢視"
            icon={<VisibilityRoundedIcon />}
            color="info"
            href={`/my-signature/${task.signerPublicId}`}
          />
        ),
      },
    ],
    rejected: [
      ...common,
      {
        header: '拒絕時間',
        sortKey: 'rejectedAt',
        nowrap: true,
        cell: ({ signer }) => formatDateTime(signer.rejectedAt) ?? '—',
      },
      {
        header: '拒絕原因',
        sortKey: 'rejectReason',
        // 完整顯示、自動換行；保留最小寬度避免被擠成過窄的一欄
        cell: ({ signer }) =>
          signer.rejectReason ? (
            <Typography variant="content" sx={{ minWidth: 240, overflowWrap: 'anywhere' }}>
              {signer.rejectReason}
            </Typography>
          ) : (
            '—'
          ),
      },
      initiator,
      {
        header: '操作',
        cell: (task) => (
          <TooltipIconButton
            label="檢視"
            icon={<VisibilityRoundedIcon />}
            color="info"
            href={`/my-signature/${task.signerPublicId}`}
          />
        ),
      },
    ],
  };

  const columns = columnsByTab[tab];

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table>
        <TableHead>
          <TableRow>
            {columns.map((col) =>
              // 只有此分頁允許的欄位可排序
              col.sortKey && SORT_KEYS_BY_TAB[tab].includes(col.sortKey) ? (
                <SortableHeaderCell
                  key={col.header}
                  active={sort?.key === col.sortKey}
                  order={sort?.order ?? 'asc'}
                  href={signingHref(tab, nextSortState(sort, col.sortKey))}
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
          {placeholder ? (
            <TableRow>
              <TableCell colSpan={columns.length} align="center" sx={{ py: 6 }}>
                {placeholder}
              </TableCell>
            </TableRow>
          ) : (
            tasks.map((task) => (
              <TableRow key={task.signerPublicId} hover>
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
