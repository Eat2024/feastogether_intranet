// 匯出紀錄（示意：存在伺服器記憶體，重啟後清空；串接後端後改存資料庫）
import { getCurrentUser } from '@/features/forms/orgChart';
import type { ExportKind, ExportRecord } from './types';

const g = globalThis as typeof globalThis & { __exportHistory?: ExportRecord[] };
const records = () => (g.__exportHistory ??= []);

export function nowStr() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 新增一筆匯出紀錄（匯出人為目前登入者） */
export function addExportRecord(
  input: Omit<ExportRecord, 'id' | 'exportedAt' | 'exportedBy' | 'redownloads'>,
): ExportRecord {
  const me = getCurrentUser();
  const record: ExportRecord = {
    ...input,
    id: `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    exportedAt: nowStr(),
    exportedBy: { id: me.id, name: me.name, employeeNo: me.employeeNo },
    redownloads: 0,
  };
  records().unshift(record);
  return record;
}

/** 依匯出時間由新到舊 */
export function listExportRecords(kind: ExportKind): ExportRecord[] {
  return records().filter((r) => r.kind === kind);
}

export function getExportRecord(id: string): ExportRecord | undefined {
  return records().find((r) => r.id === id);
}

export function markRedownloaded(record: ExportRecord) {
  record.redownloads += 1;
  record.lastRedownloadAt = nowStr();
}
