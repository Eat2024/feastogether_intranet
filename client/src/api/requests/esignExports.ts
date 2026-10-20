import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { EsignExport, ExportableDocument, ExportListParams, ExportPage } from '@/api/types';
export async function getExportableDocuments(params: ExportListParams = {}) {
  return (await api<ExportPage<ExportableDocument>>({ url: endpoints.ESIGN_EXPORTABLE_DOCUMENTS, params })).data;
}
export async function getExports(params: ExportListParams = {}) {
  return (await api<ExportPage<EsignExport>>({ url: endpoints.ESIGN_EXPORTS, params })).data;
}
export async function requestExport(documentId: string) {
  return (await api<EsignExport>({ method: 'POST', url: endpoints.ESIGN_DOCUMENT_EXPORTS(documentId), data: { type: 'signed_copies_zip' } })).data;
}
export async function retryExport(job: Pick<EsignExport, 'documentId' | 'id'>) {
  return (await api<EsignExport>({ method: 'POST', url: endpoints.ESIGN_EXPORT_RETRY(job.documentId, job.id) })).data;
}
export async function getExport(documentId: string, id: string) {
  return (await api<EsignExport>({ url: endpoints.ESIGN_EXPORT(documentId, id) })).data;
}
