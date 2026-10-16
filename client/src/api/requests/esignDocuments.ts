import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { EsignDocumentListItem, GetDocumentsParams } from '@/api/types';

/**
 * @name 列出電子簽文件
 * @description 依角色與狀態查詢目前登入員工可見的文件，依更新時間由新到舊；不分頁
 */
export const getDocuments = async (params: GetDocumentsParams = {}): Promise<EsignDocumentListItem[]> => {
  const res = await api<EsignDocumentListItem[]>({ method: 'GET', url: endpoints.ESIGN_DOCUMENTS, params });
  return res.data;
};
