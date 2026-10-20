export interface EsignExport {
  id: string;
  documentId: string;
  status: 'pending' | 'waiting' | 'processing' | 'completed' | 'failed' | 'expired';
  snapshotAt: string | null;
  expectedCount: number;
  processedCount: number;
  waitingCount: number;
  completedAt: string | null;
  expiresAt: string | null;
  failureCode: string | null;
  requesterName?: string;
  reused?: boolean;
  files: Array<{ id: string; fileName: string; size: number; sha256: string; downloadPath: string }>;
}
export interface ExportableDocument {
  documentId: string;
  title: string;
  creatorName: string;
  status: string;
  signedCount: number;
  latestExportSummary: EsignExport | null;
}
export interface ExportListParams { cursor?: string; limit?: number; documentId?: string; q?: string; status?: string }
export interface ExportPage<T> { items: T[]; nextCursor: string | null }
