import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import {
  FORM_STATUS_META,
  deriveStatus,
  signedCount,
} from './status';
import SortableHeaderCell from '@/components/SortableHeaderCell';
import RowActions from './RowActions';
import { formsHref, nextSort, type SortKey, type SortState } from './sort';
import type { EFormDoc } from './types';

const SORTABLE_COLUMNS: [SortKey, string][] = [
  ['name', '文件名稱'],
  ['docNumber', '文件編號'],
  ['startAt', '開始時間'],
  ['endAt', '結束時間'],
  ['status', '文件狀態'],
  ['progress', '簽署人狀態'],
  ['createdBy', '建立人'],
];

/** forms 需已依 sort 排序（排序在伺服器端完成） */
export default function FormsTable({
  forms,
  sort,
  query,
}: {
  forms: EFormDoc[];
  sort: SortState;
  /** 目前的搜尋關鍵字（排序連結會保留） */
  query: string;
}) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table>
        <TableHead>
          <TableRow>
            {SORTABLE_COLUMNS.map(([key, label]) => {
              const next = nextSort(sort, key);
              return (
                <SortableHeaderCell
                  key={key}
                  active={sort?.key === key}
                  order={sort?.order ?? 'asc'}
                  href={formsHref({ query, sort: next })}
                >
                  {label}
                </SortableHeaderCell>
              );
            })}
            <TableCell>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {forms.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                <Typography variant="description">
                  {query
                    ? `找不到符合「${query}」的文件，請換個關鍵字試試。`
                    : '尚無電子簽文件，點擊右上角「新增電子簽文件」建立第一份文件。'}
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            forms.map((form) => {
              const status = FORM_STATUS_META[deriveStatus(form)];
              const signed = signedCount(form);
              const total = form.signers.length;
              return (
                <TableRow key={form.id} hover>
                  <TableCell>{form.name}</TableCell>
                  {/* 草稿尚無編號、尚未發起時以「—」表示；已發起但未設結束日為「不限」 */}
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {form.docNumber ?? '—'}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {form.startAt ?? '—'}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {form.endAt ?? (form.startAt ? '不限' : '—')}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="soft"
                      label={status.label}
                      color={status.color}
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 140 }}>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                      }}
                    >
                      <LinearProgress
                        variant="determinate"
                        value={total ? (signed / total) * 100 : 0}
                      />
                      <Typography variant="helper">
                        {signed}/{total}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="content">
                      {form.createdBy.name}
                    </Typography>
                    <Typography variant="helper">
                      {form.createdBy.employeeNo}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <RowActions form={form} />
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
