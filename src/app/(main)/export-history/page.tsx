import LinkPagination from "@/components/LinkPagination";
import LinkTabs from "@/components/LinkTabs";
import PageHeader from "@/components/PageHeader";
import { isAdmin } from "@/features/export-history/admin";
import RedownloadButton from "@/features/export-history/RedownloadButton";
import { listExportRecords } from "@/features/export-history/store";
import type { ExportKind } from "@/features/export-history/types";
import { PAGE_SIZE, pageHrefs, paginate, parsePage } from "@/lib/paginate";
import Alert from "@mui/material/Alert";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "歷史匯出文件" };
export const dynamic = "force-dynamic";


const TABS: { value: ExportKind; label: string; scopeLabel: string }[] = [
  { value: "list", label: "簽署紀錄清單 Excel", scopeLabel: "匯出範圍" },
  { value: "signerCopy", label: "已簽署文件 PDF", scopeLabel: "簽署人" },
];

const href = (tab: ExportKind, page = 1) => {
  const qs = new URLSearchParams();
  if (tab !== "list") qs.set("tab", tab);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/export-history?${s}` : "/export-history";
};

export default async function ExportHistoryPage({
  searchParams,
}: PageProps<"/export-history">) {
  const header = (
    <PageHeader
      title="歷史匯出文件"
      description="查看所有人匯出的簽署紀錄與已簽署文件，並可重新下載。"
    />
  );
  if (!isAdmin()) {
    return (
      <>
        {header}
        <Alert severity="warning" variant="outlined">
          只有管理者可以查看歷史匯出文件。
        </Alert>
      </>
    );
  }

  const params = await searchParams;
  const tab = TABS.find((t) => t.value === params.tab) ?? TABS[0];
  const all = listExportRecords(tab.value);
  const { items: records, page, pageCount } = paginate(all, parsePage(params.page), PAGE_SIZE);

  return (
    <>
      {header}
      <Stack spacing={2}>
        <LinkTabs
          value={tab.value}
          tabs={TABS.map((t) => ({
            value: t.value,
            label: `${t.label}（${listExportRecords(t.value).length}）`,
            href: href(t.value),
          }))}
        />
        {/* <Typography variant="secondary" component="div" sx={{ textAlign: 'right' }}>
          共 {all.length} 筆
        </Typography> */}
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>匯出時間</TableCell>
                <TableCell>文件名稱</TableCell>
                <TableCell>文件編號</TableCell>
                <TableCell>{tab.scopeLabel}</TableCell>
                {tab.value === "list" && <TableCell>筆數</TableCell>}
                <TableCell>匯出人</TableCell>
                <TableCell>重新下載</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <Typography variant="description">
                      目前還沒有匯出紀錄。
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                records.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {r.exportedAt}
                    </TableCell>
                    <TableCell>{r.formName}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {r.docNumber ?? "—"}
                    </TableCell>
                    <TableCell sx={{ minWidth: 200 }}>{r.scope}</TableCell>
                    {tab.value === "list" && <TableCell>{r.count}</TableCell>}
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <Typography variant="content">
                        {r.exportedBy.name}
                      </Typography>
                      <Typography variant="helper">
                        {r.exportedBy.employeeNo}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <RedownloadButton recordId={r.id} kind={r.kind} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <LinkPagination
          page={page}
          hrefs={pageHrefs(pageCount, (p) => href(tab.value, p))}
        />
      </Stack>
    </>
  );
}
