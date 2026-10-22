import api from '@/api/config';
import { endpoints } from '@/api/endpoints';
import type { SignatureVerification } from '@/api/types';

/**
 * @name 查詢簽章驗證結果
 * @description 公開 API，不需登入；以簽署人 IP 限流（60 秒 10 次、300 秒 50 次），須由瀏覽器端呼叫。
 * 查無或代碼無效回 404、資料不一致回 409、過於頻繁回 429
 */
export const getSignatureVerification = async (code: string): Promise<SignatureVerification> => {
  const res = await api<SignatureVerification>({ method: 'GET', url: endpoints.SIGNATURE_VERIFICATION(code) });
  return res.data;
};
