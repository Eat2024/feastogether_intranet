'use client';

// 電子簽列表（後端資料）：GET /api/esign/documents?role=created 取得目前員工建立的文件，
// 搜尋、篩選、排序與分頁依網址參數在前端處理。
import { useGetDocumentsQuery } from '@/api/queries';
import LinkPagination from '@/components/LinkPagination';
import SearchField from '@/components/SearchField';
import FormsFilterBar from '@/features/forms/FormsFilterBar';
import { getErrorMessage } from '@/lib/apiError';
import { PAGE_SIZE, pageHrefs, paginate, parsePage } from '@/lib/paginate';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import DocumentsTable from './DocumentsTable';
import {
  DOCUMENT_STATUS_OPTIONS,
  documentsHref,
  filterDocuments,
  hasDocumentFilters,
  parseDocumentFilters,
  parseDocumentSort,
  sortDocuments,
} from './listQuery';

export default function DocumentsListView() {
  const params = useSearchParams();
  const filters = useMemo(() => parseDocumentFilters(params), [params]);
  const sort = useMemo(() => parseDocumentSort(params), [params]);
  const { data, isPending, isError, error, refetch, isFetching } = useGetDocumentsQuery({ role: 'created' });

  const docs = useMemo(() => {
    return sortDocuments(filterDocuments(data ?? [], filters), sort);
  }, [data, filters, sort]);
  const { items, page, pageCount } = paginate(docs, parsePage(params.get('page') ?? undefined), PAGE_SIZE);

  // 沒有資料列時表格內顯示的內容
  const placeholder = isPending ? (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
      <CircularProgress size={20} />
      <Typography variant="description">載入文件中…</Typography>
    </Box>
  ) : isError ? (
    <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
      <Typography variant="description">無法取得文件列表：{getErrorMessage(error)}</Typography>
      <Button variant="outlined" onClick={() => refetch()} loading={isFetching}>
        重新載入
      </Button>
    </Stack>
  ) : items.length === 0 ? (
    <Typography variant="description">
      {hasDocumentFilters(filters)
        ? filters.query
          ? `找不到符合「${filters.query}」的文件，請換個關鍵字或篩選條件試試。`
          : '沒有符合篩選條件的文件，請調整篩選條件試試。'
        : '尚無電子簽文件，點擊右上角「新增電子簽文件」建立第一份文件。'}
    </Typography>
  ) : null;

  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, flex: 1, minWidth: 0 }}>
          <SearchField placeholder="搜尋文件名稱或建立人" width={260} />
          <FormsFilterBar
            statuses={filters.statuses}
            from={filters.from}
            to={filters.to}
            statusOptions={DOCUMENT_STATUS_OPTIONS}
          />
        </Box>
        <Typography variant="secondary" component="span" sx={{ flexShrink: 0 }}>
          {isPending || isError ? '—' : `共 ${docs.length} 筆`}
        </Typography>
      </Box>
      <DocumentsTable docs={items} sort={sort} filters={filters} placeholder={placeholder} />
      <LinkPagination page={page} hrefs={pageHrefs(pageCount, (p) => documentsHref({ filters, sort, page: p }))} />
    </Stack>
  );
}
