import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { E2eServer } from './api-response.helper';

/** 簽章驗證網址：EXTERNAL_SIGNING_ORIGIN/verify/{110 字元 token}（e2e origin 為 localhost:3000）。 */
export const VERIFICATION_URL =
  /^http:\/\/localhost:3000\/verify\/([A-Za-z0-9_-]{110})$/;

export interface SignatureVerification {
  signature: {
    signerName: string;
    signedAt: string;
    authenticationMethod: string;
  };
  document: {
    title: string;
    status: string;
    signedSourceSha256: string;
    completedAt: string | null;
    stoppedAt: string | null;
    completedPdfSha256: string | null;
  };
}

/**
 * 隨機 benchmark 網段 client IP。限流計數存 Redis 且跨測試回合存活，
 * 每次查詢換 IP 才不會因重跑而互相消耗額度（app 以 trustProxy=1 解析 X-Forwarded-For）。
 */
export function randomClientIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `198.18.${octet()}.${octet()}`;
}

/** 以驗證網址或 token 查詢公開簽章驗證；不帶任何 cookie。 */
export function getSignatureVerification(
  server: E2eServer,
  urlOrToken: string,
  clientIp = randomClientIp(),
) {
  const token = urlOrToken.split('/verify/').at(-1)!;
  return request(server)
    .get(`/api/signature-verifications/${token}`)
    .set('X-Forwarded-For', clientIp);
}

const ESIGN_TABLES = [
  'esign_documents',
  'esign_signers',
  'esign_signature_records',
  'esign_file_objects',
  'esign_audit_events',
  'esign_verification_records',
];

/** 電子簽各表筆數；用來確認公開驗證查詢前後沒有任何寫入。 */
export async function esignRowCounts(
  db: DataSource,
): Promise<Record<string, number>> {
  const [row] = await db.query<Array<Record<string, number | string>>>(
    `SELECT ${ESIGN_TABLES.map((table) => `(SELECT COUNT(*) FROM ${table}) ${table}`).join(', ')}`,
  );
  return Object.fromEntries(
    Object.entries(row).map(([table, count]) => [table, Number(count)]),
  );
}
