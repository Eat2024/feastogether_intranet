// 產生簽署紀錄清單的 Excel 檔（僅供伺服器端使用）
import { color } from '@/theme/tokens';
import ExcelJS from 'exceljs';
import { getProgress, periodText } from '../status';
import type { EFormDoc } from '../types';
import { describeScope, FIELDS, type ExportQuery, type ExportRow } from './exportQuery';

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;

export async function buildSignerXlsx(
  form: EFormDoc,
  query: ExportQuery,
  rows: ExportRow[],
  exportedAt: string,
  /** 勾選部門的名稱（空陣列表示全部部門） */
  deptNames: string[],
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '電子簽署';
  wb.created = new Date();

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
  const progress = getProgress(form);
  const info = wb.addWorksheet('文件資訊');
  info.columns = [
    { key: 'k', width: 16 },
    { key: 'v', width: 48 },
  ];
  [
    ['文件名稱', form.name],
    ['文件編號', form.docNumber ?? ''],
    ['建立人', `${form.createdBy.name}（${form.createdBy.employeeNo}）`],
    ['簽署期間', periodText(form)],
    ['簽署進度', `已簽署 ${progress.signed}／待簽署 ${progress.pending}／已拒絕 ${progress.rejected}（共 ${progress.total} 人）`],
    ['匯出範圍', describeScope(query, deptNames)],
    ['匯出筆數', String(rows.length)],
    ['匯出時間', exportedAt],
    ['注意', '本檔案含個人資料，請妥善保管，勿任意轉傳。'],
  ].forEach(([k, v]) => info.addRow({ k, v }));
  info.getColumn(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
