import type { FastifyReply } from 'fastify';

/**
 * 瀏覽器直接開啟的頁面（Email 連結、表單送出、WebView）出錯時回簡單 HTML，不讓使用者看到 JSON。
 * title、message 只放固定文案，不放例外訊息或使用者輸入。
 */
export function sendHtmlErrorPage(
  reply: FastifyReply,
  status: number,
  title: string,
  message: string,
): void {
  reply
    .status(status)
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${title}</title></head><body><p>${message}</p></body></html>`,
    );
}
