import fastify from 'fastify';
import { allowPdfPreview } from './pdf-frame-policy';

describe('PDF 預覽嵌入政策', () => {
  it.each([
    [undefined, "frame-ancestors 'self';"],
    [
      ' https://portal.example.test, http://localhost:8080,https://portal.example.test/ ',
      "frame-ancestors 'self' https://portal.example.test http://localhost:8080;",
    ],
  ])('覆寫 DENY 並保留其他安全標頭：%s', async (origins, policy) => {
    const app = fastify();
    app.addHook('onRequest', async (_request, reply) => {
      reply.header('X-Frame-Options', 'DENY');
      reply.header('X-Content-Type-Options', 'nosniff');
    });
    app.get('/pdf', (_request, reply) => {
      allowPdfPreview(reply, origins);
      return reply
        .header('Cache-Control', 'private, no-store')
        .type('application/pdf')
        .send(Buffer.from('%PDF-1.7'));
    });
    try {
      const response = await app.inject('/pdf');
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-frame-options']).toBeUndefined();
      expect(response.headers['content-security-policy']).toBe(policy);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('private, no-store');
    } finally {
      await app.close();
    }
  });

  it.each(['*', 'https://*.example.test', 'javascript:alert(1)'])(
    '錯誤設定不放寬嵌入限制：%s',
    async (origin) => {
      const app = fastify();
      app.get('/pdf', (_request, reply) => {
        reply.header('X-Frame-Options', 'DENY');
        allowPdfPreview(reply, origin);
        return reply.send('不得抵達');
      });
      try {
        const response = await app.inject('/pdf');
        expect(response.statusCode).toBe(500);
        expect(response.headers['x-frame-options']).toBe('DENY');
      } finally {
        await app.close();
      }
    },
  );
});
