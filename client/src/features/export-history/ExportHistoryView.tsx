"use client";

// 歷史匯出文件：GET /api/esign/history/export（Spec 017，同部門文件的匯出紀錄，依匯出時間由新到舊）。
// 依類型分頁標籤（Excel／PDF／ZIP），頁碼分頁；類型、頁碼、搜尋與排序記在網址參數 tab、page、q、sort、order。
// 後端沒有排序參數：未排序時沿用後端分頁；點欄位排序後改為取回該類型全部紀錄，在前端排序、分頁。
// 簽到表後端尚未完成，分頁先隱藏。
import {
  useGetAllExportHistoryQuery,
  useGetExportHistoryQuery,
} from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import {
  getExcelExportDocument,
  prepareExportDownload,
  preparedExportFileUrl,
  redownloadPdfExport,
  retryDocumentExport,
} from "@/api/requests";
import type {
  EsignExportStatus,
  ExcelExportHistoryItem,
  ExportHistoryItemByType,
  ExportHistoryType,
  PdfExportHistoryItem,
  ZipExportHistoryItem,
} from "@/api/types";
import LinkPagination from "@/components/LinkPagination";
import LinkTabs from "@/components/LinkTabs";
import { useSnackbar } from "@/components/providers/SnackbarProvider";
import SearchField from "@/components/SearchField";
import SortableHeaderCell from "@/components/SortableHeaderCell";
import TooltipIconButton from "@/components/TooltipIconButton";
import {
  buildDeptOptions,
  exportRows,
  selectedDeptNames,
} from "@/features/esign-documents/exportQuery";
import { formatDateTime } from "@/features/esign-documents/listQuery";
import { getErrorCode, getErrorMessage } from "@/lib/apiError";
import { PAGE_SIZE, pageHrefs, paginate, parsePage } from "@/lib/paginate";
import {
  nextSortState,
  parseSortParams,
  sortByValue,
  type Sort,
  type SortValue,
} from "@/lib/tableSort";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip, { type ChipProps } from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import HistoryDownloadButton from "./HistoryDownloadButton";
import { ESIGN_ROUTES } from "@/constants/routes/esign";

type HistoryTab = ExportHistoryType | "sheet";

// TODO: 後端完成簽到表後改為 true 並串接 API
const SHEET_ENABLED = false;

const TABS: { value: HistoryTab; label: string }[] = [
  { value: "excel", label: "簽署紀錄清單 Excel" },
  { value: "pdf", label: "已簽署文件 PDF" },
  { value: "zip", label: "已簽署文件 ZIP" },
  ...(SHEET_ENABLED
    ? [{ value: "sheet" as const, label: "簽到表 PDF（尚未完成）" }]
    : []),
];

// ── 排序 ──────────────────────────────────────────────

type HistorySortKey =
  | "exportedAt"
  | "title"
  | "fileName"
  | "docNumber"
  | "scope"
  | "count"
  | "status"
  | "exportedBy";
type HistorySort = Sort<HistorySortKey>;
type HistoryItem = ExportHistoryItemByType[ExportHistoryType];

/** 各類型可排序的欄位（切換分頁標籤時排序會清除） */
const SORT_KEYS_BY_TYPE: Record<ExportHistoryType, readonly HistorySortKey[]> =
  {
    excel: ["exportedAt", "title", "fileName", "docNumber", "scope", "count", "exportedBy"],
    pdf: ["exportedAt", "title", "fileName", "docNumber", "scope", "exportedBy"],
    zip: ["exportedAt", "title", "fileName", "docNumber", "count", "status", "exportedBy"],
  };

// ZIP 狀態依處理流程排序
const ZIP_STATUS_ORDER: EsignExportStatus[] = [
  "pending",
  "waiting",
  "processing",
  "completed",
  "failed",
  "superseded",
];

/** 各欄的排序值（ISO 時間可直接以字串比較）；同名匯出人以員編或 Email 區分 */
const SORT_VALUE: Record<HistorySortKey, (r: HistoryItem) => SortValue> = {
  exportedAt: (r) => r.exportedAt,
  title: (r) => r.document.title,
  // 「未記錄」的舊紀錄沒有檔名，排在最後
  fileName: (r) => r.downloadFileName,
  docNumber: (r) => r.document.docNumber,
  scope: (r) => r.scope || null,
  count: (r) => r.count,
  status: (r) => (r.type === "zip" ? ZIP_STATUS_ORDER.indexOf(r.status) : null),
  exportedBy: (r) =>
    `${r.exportedBy.name}\u0000${r.exportedBy.employeeNo ?? r.exportedBy.email ?? ""}`,
};

const historyHref = (
  tab: HistoryTab,
  page = 1,
  query = "",
  sort: HistorySort = null,
) => {
  const qs = new URLSearchParams();
  if (query) qs.set("q", query);
  if (tab !== "excel") qs.set("tab", tab);
  if (sort) {
    qs.set("sort", sort.key);
    qs.set("order", sort.order);
  }
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `${ESIGN_ROUTES.exportHistory.href}?${s}` : ESIGN_ROUTES.exportHistory.href;
};

const ZIP_STATUS_META: Record<
  EsignExportStatus,
  { label: string; color: ChipProps["color"] }
> = {
  pending: { label: "排隊中", color: "default" },
  waiting: { label: "等待副本產製", color: "info" },
  processing: { label: "打包中", color: "info" },
  completed: { label: "可下載", color: "success" },
  failed: { label: "失敗", color: "error" },
  superseded: { label: "已被新版取代", color: "default" },
};

const ZIP_IN_PROGRESS: EsignExportStatus[] = [
  "pending",
  "waiting",
  "processing",
];

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** ZIP 未完成工作重試後更新工作狀態與列表 */
function useRefreshHistory() {
  const queryClient = useQueryClient();
  return () =>
    void queryClient.invalidateQueries({
      queryKey: [queryKeys.ESIGN_EXPORT_HISTORY],
    });
}

// 重新下載一律使用紀錄的匯出檔名；「未記錄」的舊紀錄沿用各類型的預設檔名。

/** Excel：依原條件與文件目前資料重新產生，不新增歷史紀錄 */
function ExcelRedownload({ record }: { record: ExcelExportHistoryItem }) {
  return (
    <HistoryDownloadButton
      label="依當時條件以目前資料重新產生"
      onDownload={async () => {
        const [doc, { buildExportXlsx }] = await Promise.all([
          getExcelExportDocument(record.id),
          import("@/features/esign-documents/buildExportXlsx"),
        ]);
        const rows = exportRows(doc.signers, record.conditions);
        const deptNames = selectedDeptNames(
          record.conditions.depts,
          buildDeptOptions(doc.signers),
        );
        const { blob, fileName } = await buildExportXlsx(
          doc,
          record.conditions,
          rows,
          deptNames,
        );
        saveBlob(blob, record.downloadFileName ?? fileName);
      }}
    />
  );
}

/** PDF：下載該簽署人目前的已簽署副本，不新增歷史紀錄 */
function PdfRedownload({ record }: { record: PdfExportHistoryItem }) {
  return (
    <HistoryDownloadButton
      label="重新下載"
      onDownload={async () => {
        const { bytes, fileName } = await redownloadPdfExport(record.id);
        saveBlob(bytes, record.downloadFileName ?? fileName);
      }}
    />
  );
}

/** ZIP：下載或重試尚未成功的匯出；舊不可用成果不重新產生。 */
function ZipAction({ record }: { record: ZipExportHistoryItem }) {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const refresh = useRefreshHistory();
  const retry = useMutation({
    mutationFn: retryDocumentExport,
    meta: { suppressGlobalErrorToast: true },
    onSuccess: () => {
      refresh();
      showSnackbar("已重新受理匯出，完成後即可下載", "success");
    },
    onError: (err) =>
      showSnackbar(getErrorMessage(err, "重試失敗，請稍後再試"), "error"),
  });

  const file = record.files[0];
  if (record.status === "completed" && file) {
    // 檔案可能很大，以瀏覽器直接下載（支援續傳），不先讀進記憶體
    return (
      <HistoryDownloadButton
        label="下載 ZIP"
        onDownload={async () => {
          const prepared = await prepareExportDownload(record.document.id, {
            type: "zip",
            exportId: record.id,
            fileId: file.id,
            fileName: record.downloadFileName ?? undefined,
          }).catch((error: unknown) => {
            if (getErrorCode(error) === "ESIGN_EXPORT_SUPERSEDED") {
              refresh();
              void queryClient.invalidateQueries({
                queryKey: [queryKeys.ESIGN_DOCUMENT_EXPORT_PREVIEW, record.document.id],
              });
              void queryClient.invalidateQueries({
                queryKey: [queryKeys.ESIGN_DOCUMENT, record.document.id],
              });
              void queryClient.invalidateQueries({
                queryKey: [queryKeys.ESIGN_DOCUMENT_EXPORT, record.document.id, record.id],
              });
            }
            throw error;
          });
          const link = document.createElement("a");
          link.href = preparedExportFileUrl(prepared.downloadPath);
          link.download = prepared.fileName;
          link.target = "_blank";
          link.rel = "noopener";
          link.click();
        }}
      />
    );
  }
  if (record.status === "failed") {
    // 文件完整性錯誤無法重試
    const canRetry = record.failureCode !== "ESIGN_INTEGRITY_FAILED";
    return (
      <TooltipIconButton
        label={
          canRetry ? "重試匯出" : "無法重試：文件驗證未通過，請聯絡系統管理員"
        }
        icon={<ReplayRoundedIcon />}
        color="info"
        disabled={!canRetry || retry.isPending}
        onClick={() =>
          retry.mutate({ id: record.document.id, exportId: record.id })
        }
      />
    );
  }
  if (record.status === "superseded") {
    return <Typography variant="helper">已被新版取代</Typography>;
  }
  return (
    <Typography variant="helper" component="span">
      處理中
    </Typography>
  );
}

type HeadCell = { label: string; sortKey?: HistorySortKey };

/** 各類型不同的欄位：表頭與每列的儲存格 */
type ColumnSet<T extends ExportHistoryType> = {
  head: HeadCell[];
  cells: (r: ExportHistoryItemByType[T]) => ReactNode;
};

const COLUMN_SETS: { [T in ExportHistoryType]: ColumnSet<T> } = {
  excel: {
    head: [
      { label: "匯出範圍", sortKey: "scope" },
      { label: "筆數", sortKey: "count" },
    ],
    cells: (r) => (
      <>
        <TableCell sx={{ minWidth: 200 }}>{r.scope}</TableCell>
        <TableCell>{r.count}</TableCell>
      </>
    ),
  },
  pdf: {
    head: [{ label: "簽署人", sortKey: "scope" }],
    cells: (r) => <TableCell sx={{ minWidth: 200 }}>{r.scope}</TableCell>,
  },
  zip: {
    head: [
      { label: "收錄份數", sortKey: "count" },
      { label: "狀態", sortKey: "status" },
    ],
    cells: (r) => {
      const status = ZIP_STATUS_META[r.status];
      return (
        <>
          <TableCell>{r.count} 份</TableCell>
          <TableCell sx={{ whiteSpace: "nowrap" }}>
            <Chip
              size="small"
              variant="soft"
              label={status.label}
              color={status.color}
            />
            {r.status === "waiting" && (
              <Typography variant="helper" component="div">
                尚有 {r.waitingCount} 份副本產製中
              </Typography>
            )}
          </TableCell>
        </>
      );
    },
  },
};

function RecordAction({
  record,
}: {
  record: ExportHistoryItemByType[ExportHistoryType];
}) {
  if (record.type === "excel") return <ExcelRedownload record={record} />;
  if (record.type === "pdf") return <PdfRedownload record={record} />;
  return <ZipAction record={record} />;
}

export default function ExportHistoryView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const type: ExportHistoryType =
    tabParam === "pdf" || tabParam === "zip" ? tabParam : "excel";
  const requestedPage = parsePage(params.get("page") ?? undefined);
  const query = (params.get("q") ?? "").trim();
  const sort = parseSortParams(
    {
      sort: params.get("sort") ?? undefined,
      order: params.get("order") ?? undefined,
    },
    SORT_KEYS_BY_TYPE[type],
  );
  // ZIP 有紀錄還在處理中時定期更新
  const pollWhileZipInProgress = {
    refetchInterval: (q: { state: { data?: { items: HistoryItem[] } } }) =>
      q.state.data?.items.some(
        (r) => r.type === "zip" && ZIP_IN_PROGRESS.includes(r.status),
      )
        ? 5000
        : false,
  };
  // 未排序：後端分頁；排序：取回全部紀錄在前端排序、分頁（兩者只會啟用一個）
  const paged = useGetExportHistoryQuery(
    { type, q: query || undefined, page: requestedPage, pageSize: PAGE_SIZE },
    { enabled: !sort, ...pollWhileZipInProgress },
  );
  const all = useGetAllExportHistoryQuery(
    { type, q: query || undefined },
    { enabled: !!sort, ...pollWhileZipInProgress },
  );
  const active = sort ? all : paged;
  const { isPending, isError, error, refetch, isFetching } = active;
  const data = paged.data;
  const local =
    sort && all.data
      ? paginate(
          sortByValue(all.data.items, SORT_VALUE[sort.key], sort.order),
          requestedPage,
          PAGE_SIZE,
        )
      : null;
  const items: HistoryItem[] = local ? local.items : (paged.data?.items ?? []);
  const typeTotals = (sort ? all.data : paged.data)?.typeTotals;

  const page = local?.page ?? data?.page ?? requestedPage;
  // 後端分頁時，等待目前條件的回應，再以後端有效頁碼導正網址；保留關鍵字與其他條件。
  useEffect(() => {
    if (sort || !data || isError) return;
    const canonicalPage = data.page > 1 ? String(data.page) : null;
    if (
      params.get("page") === canonicalPage &&
      params.getAll("page").length <= 1
    )
      return;
    const qs = new URLSearchParams(params);
    qs.delete("page");
    if (canonicalPage) qs.set("page", canonicalPage);
    const queryString = qs.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  }, [sort, data, isError, params, pathname, router]);

  const columns = COLUMN_SETS[type] as ColumnSet<ExportHistoryType>;
  const head: HeadCell[] = [
    { label: "匯出時間", sortKey: "exportedAt" },
    { label: "文件名稱", sortKey: "title" },
    { label: "匯出檔名", sortKey: "fileName" },
    { label: "文件編號", sortKey: "docNumber" },
    ...columns.head,
    { label: "匯出人", sortKey: "exportedBy" },
    // 操作欄不排序
    { label: "重新下載" },
  ];
  const pageCount = isError
    ? 1
    : local
      ? local.pageCount
      : data
        ? Math.max(1, Math.ceil(data.total / data.pageSize))
        : 1;

  const placeholder = isPending ? (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
      }}
    >
      <CircularProgress size={20} />
      <Typography variant="description">載入匯出紀錄中…</Typography>
    </Box>
  ) : isError ? (
    <Stack spacing={1.5} sx={{ alignItems: "center" }}>
      <Typography variant="description">
        無法取得匯出紀錄：{getErrorMessage(error)}
      </Typography>
      <Button variant="outlined" onClick={() => refetch()} loading={isFetching}>
        重新載入
      </Button>
    </Stack>
  ) : items.length === 0 ? (
    <Typography variant="description">
      {query ? `找不到符合「${query}」的匯出紀錄。` : "目前還沒有匯出紀錄。"}
    </Typography>
  ) : null;

  return (
    <Stack spacing={2}>
      <SearchField placeholder="搜尋文件名稱、文件編號或建立人" width={320} />
      <LinkTabs
        value={type}
        tabs={TABS.map((t) => ({
          value: t.value,
          label:
            t.value !== "sheet" && typeTotals && !isError
              ? `${t.label}（${typeTotals[t.value]}）`
              : t.label,
          href: historyHref(t.value, 1, query),
        }))}
      />
      {type === "zip" && (
        <Typography variant="helper" component="div">
          每份文件的已簽署副本（每人一份 PDF）打包成一個 ZIP；ZIP
          產生後持續保留並沿用同一份，不包含後續新增的簽署。
        </Typography>
      )}
      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              {head.map((c) =>
                c.sortKey ? (
                  <SortableHeaderCell
                    key={c.label}
                    active={sort?.key === c.sortKey}
                    order={sort?.key === c.sortKey ? sort.order : "asc"}
                    href={historyHref(
                      type,
                      1,
                      query,
                      nextSortState(sort, c.sortKey),
                    )}
                  >
                    {c.label}
                  </SortableHeaderCell>
                ) : (
                  <TableCell key={c.label}>{c.label}</TableCell>
                ),
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {placeholder ? (
              <TableRow>
                <TableCell colSpan={head.length} align="center" sx={{ py: 6 }}>
                  {placeholder}
                </TableCell>
              </TableRow>
            ) : (
              items.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {formatDateTime(r.exportedAt)}
                  </TableCell>
                  <TableCell>{r.document.title}</TableCell>
                  <TableCell sx={{ overflowWrap: "anywhere", minWidth: 180, maxWidth: 320 }}>
                    {r.downloadFileName ?? "未記錄"}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {r.document.docNumber}
                  </TableCell>
                  {columns.cells(r)}
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Typography variant="content">
                      {r.exportedBy.name}
                    </Typography>
                    <Typography variant="helper">
                      {r.exportedBy.employeeNo ?? r.exportedBy.email}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <RecordAction record={r} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <LinkPagination
        page={page}
        hrefs={pageHrefs(pageCount, (p) => historyHref(type, p, query, sort))}
      />
    </Stack>
  );
}
