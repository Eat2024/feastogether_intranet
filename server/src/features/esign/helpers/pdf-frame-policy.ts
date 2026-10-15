import type { FastifyReply } from 'fastify';

/** 僅在授權成功的 PDF 預覽回應使用；Portal 巢狀 iframe 的所有祖先都必須被允許。 */
export function allowPdfPreview(
  reply: FastifyReply,
  trustedOrigins = '',
): void {
  const origins = trustedOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hostname.includes('*')
      ) {
        throw new Error('PDF 嵌入來源必須是明確的 HTTP(S) origin');
      }
      return url.origin;
    });
  reply.header(
    'Content-Security-Policy',
    `frame-ancestors ${["'self'", ...new Set(origins)].join(' ')};`,
  );
  reply.removeHeader('X-Frame-Options');
}
