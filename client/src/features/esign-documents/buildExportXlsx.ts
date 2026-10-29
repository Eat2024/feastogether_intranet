// 在瀏覽器端產生簽署紀錄清單 Excel（格式與 mock 版 features/forms/export/buildXlsx.ts 相同）。
// exceljs 套件較大，由呼叫端在點擊匯出時以 dynamic import 載入本檔。
import { createExcelExportRecord } from '@/api/requests';
import type { EsignDocumentDetail } from '@/api/types';
import { color } from '@/theme/tokens';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';
import { periodText } from './listQuery';
import {
  buildDeptOptions,
  describeScope,
  exportRows,
  FIELDS,
  selectedDeptNames,
  type ExportQuery,
  type ExportSigner,
} from './exportQuery';

/** 產生 Excel 用到的文件欄位（文件詳情與歷史匯出的重新下載資料都有） */
export type ExportDocument = Pick<
  EsignDocumentDetail,
  'title' | 'docNumber' | 'createdBy' | 'signStartAt' | 'signEndAt' | 'originalSignEndAt' | 'isReopened'
> & { signers: ExportSigner[] };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;

export async function buildExportXlsx(
  doc: ExportDocument,
  query: ExportQuery,
  rows: ExportSigner[],
  /** 勾選部門的名稱（空陣列表示全部部門） */
  deptNames: string[],
): Promise<{ blob: Blob; fileName: string }> {
  const now = dayjs();
  const wb = new ExcelJS.Workbook();
  wb.creator = '電子簽署';
  wb.created = now.toDate();

  // 工作表 1：簽署紀錄
  const fields = FIELDS.filter((f) => query.fields.includes(f.key));
  const ws = wb.addWorksheet('簽署紀錄', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = fields.map((f) => ({ header: f.label, key: f.key, width: f.width }));
  for (const r of rows) {
    ws.addRow(Object.fromEntries(fields.map((f) => [f.key, f.value(r)])));
  }
  // 員工編號等欄位強制為文字格式，避免開頭的 0 被 Excel 去掉
  fields.forEach((_, i) => {
    ws.getColumn(i + 1).numFmt = '@';
  });
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: argb(color.textHeadline) } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(color.formBorder) } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fields.length } };

  // 工作表 2：文件資訊（匯出條件與摘要，方便日後對照）
  const count = (st: ExportSigner['status']) => doc.signers.filter((s) => s.status === st).length;
  const info = wb.addWorksheet('文件資訊');
  info.columns = [
    { key: 'k', width: 16 },
    { key: 'v', width: 48 },
  ];
  [
    ['文件名稱', doc.title],
    ['文件編號', doc.docNumber],
    ['建立人', doc.createdBy ? `${doc.createdBy.name}（${doc.createdBy.employeeNo}）` : ''],
    ['簽署期間', periodText(doc)],
    [
      '簽署進度',
      `已簽署 ${count('signed')}／待簽署 ${count('pending')}／已拒絕 ${count('rejected')}（共 ${doc.signers.length} 人）`,
    ],
    ['匯出範圍', describeScope(query, deptNames)],
    ['匯出筆數', String(rows.length)],
    ['匯出時間', now.format('YYYY/MM/DD HH:mm')],
    ['注意', '本檔案含個人資料，請妥善保管，勿任意轉傳。'],
  ].forEach(([k, v]) => info.addRow({ k, v }));
  info.getColumn(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: XLSX_MIME }),
    fileName: `${doc.docNumber}_簽署紀錄_${now.format('YYYYMMDD')}.xlsx`,
  };
}

/**
 * 匯出簽署紀錄 Excel：先以 POST /api/esign/history/export 記錄匯出，成功後才產生並下載。
 * 匯出頁與歷史匯出的重新下載共用；範圍與筆數依文件目前的資料計算。
 */
export async function recordAndDownloadExcel(doc: ExportDocument & { id: string }, query: ExportQuery) {
  const rows = exportRows(doc.signers, query);
  const deptNames = selectedDeptNames(query.depts, buildDeptOptions(doc.signers));
  await createExcelExportRecord({
    type: 'excel',
    documentId: doc.id,
    scope: describeScope(query, deptNames),
    count: rows.length,
    conditions: { statuses: query.statuses, depts: query.depts, fields: query.fields },
  });
  const { blob, fileName } = await buildExportXlsx(doc, query, rows, deptNames);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
