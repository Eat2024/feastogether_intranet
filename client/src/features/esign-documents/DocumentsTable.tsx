'use client';

import SortableHeaderCell from '@/components/SortableHeaderCell';
import type { EsignDocumentListItem } from '@/api/types';
import { nextSortState } from '@/lib/tableSort';
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
import type { ReactNode } from 'react';
import DocumentRowActions from './DocumentRowActions';
import {
  DOCUMENT_STATUS_META,
  documentStatus,
  documentsHref,
  formatDate,
  type DocumentFilters,
  type DocumentSort,
  type DocumentSortKey,
} from './listQuery';

const SORTABLE_COLUMNS: [DocumentSortKey, string][] = [
  ['name', '文件名稱'],
  ['docNumber', '文件編號'],
  ['startAt', '開始時間'],
  ['endAt', '結束時間'],
  ['status', '文件狀態'],
  ['progress', '簽署人狀態'],
  ['createdBy', '建立人'],
];
const COLUMN_COUNT = SORTABLE_COLUMNS.length + 1;

/** 電子簽列表（後端資料）；docs 需已篩選、排序、分頁 */
export default function DocumentsTable({
  docs,
  sort,
  filters,
  /** 沒有資料列時顯示的內容（載入中、錯誤或空列表） */
  placeholder,
}: {
  docs: EsignDocumentListItem[];
  sort: DocumentSort;
  filters: DocumentFilters;
  placeholder?: ReactNode;
}) {
  const now = new Date();
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table>
        <TableHead>
          <TableRow>
            {SORTABLE_COLUMNS.map(([key, label]) => (
              <SortableHeaderCell
                key={key}
                active={sort?.key === key}
                order={sort?.order ?? 'asc'}
                href={documentsHref({ filters, sort: nextSortState(sort, key) })}
              >
                {label}
              </SortableHeaderCell>
            ))}
            <TableCell>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {placeholder ? (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ py: 6 }}>
                {placeholder}
              </TableCell>
            </TableRow>
          ) : (
            docs.map((doc) => {
              const status = DOCUMENT_STATUS_META[documentStatus(doc, now)];
              const total = doc.signedCount + doc.pendingCount;
              return (
                <TableRow key={doc.id} hover>
                  <TableCell>{doc.title}</TableCell>
                  {/* 草稿尚未發起時以「—」表示；已發起但未設結束時間為「不限」 */}
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{doc.docNumber || '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(doc.signStartAt) ?? '—'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatDate(doc.signEndAt) ?? (doc.signStartAt ? '不限' : '—')}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="soft" label={status.label} color={status.color} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 140 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <LinearProgress variant="determinate" value={total ? (doc.signedCount / total) * 100 : 0} />
                      <Typography variant="helper">
                        {doc.signedCount}/{total}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {doc.createdBy ? (
                      <>
                        <Typography variant="content">{doc.createdBy.name}</Typography>
                        <Typography variant="helper">{doc.createdBy.employeeNo}</Typography>
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <DocumentRowActions doc={doc} />
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
