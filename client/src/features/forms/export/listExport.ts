// 產生簽署紀錄清單 Excel（僅供伺服器端使用）；下載路由與歷史匯出的重新下載共用
import { getDeptName } from '../orgChart';
import type { EFormDoc } from '../types';
import { buildSignerXlsx } from './buildXlsx';
import { buildSignerDeptTree, selectedDeptKeys, selectedDeptNames, signerDeptKey } from './deptTree';
import { describeScope, exportRows, type ExportQuery } from './exportQuery';

const p = (n: number) => String(n).padStart(2, '0');

export async function buildListExport(form: EFormDoc, query: ExportQuery) {
  const rows = exportRows(form, query, {
    deptOf: getDeptName,
    deptKeyOf: signerDeptKey,
    deptKeys: selectedDeptKeys(query.depts),
  });
  const deptNames = selectedDeptNames(query.depts, buildSignerDeptTree(form));
  const now = new Date();
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const exportedAt = `${now.getFullYear()}/${p(now.getMonth() + 1)}/${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  const file = await buildSignerXlsx(form, query, rows, exportedAt, deptNames);
  return {
    file,
    count: rows.length,
    scope: describeScope(query, deptNames),
    fileName: `${form.docNumber ?? form.id}_簽署紀錄_${stamp}.xlsx`,
  };
}
