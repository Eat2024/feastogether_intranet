import { createServer, type Socket } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { SmtpInvitationMailSender } from './smtp-invitation-mail-sender.service';

/** 真正 Nodemailer SMTP 對話，檢查 envelope 與實際 DATA，而非 sendMail 參數。 */
it('BCC 真實 MIME 不含收件名單，SMTP 部分 RCPT 拒收保留逐地址結果', async () => {
  const recipients: string[] = [];
  let message = '';
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 local.test ESMTP\r\n');
    let pending = '';
    let data = false;
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      while (pending.includes('\r\n')) {
        const index = pending.indexOf('\r\n');
        const line = pending.slice(0, index);
        pending = pending.slice(index + 2);
        if (data) {
          if (line === '.') {
            data = false;
            socket.write('250 accepted\r\n');
          } else message += `${line}\r\n`;
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250 local.test\r\n');
        else if (line.startsWith('MAIL FROM:'))
          socket.write('250 sender ok\r\n');
        else if (line.startsWith('RCPT TO:')) {
          const address = /<([^>]+)>/.exec(line)?.[1] ?? '';
          recipients.push(address);
          socket.write(
            address.startsWith('temporary')
              ? '450 retry later\r\n'
              : address.startsWith('permanent')
                ? '550 unavailable\r\n'
                : '250 recipient ok\r\n',
          );
        } else if (line === 'DATA') {
          data = true;
          socket.write('354 continue\r\n');
        } else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('測試 SMTP 未啟動');
    const sender = new SmtpInvitationMailSender(
      new ConfigService({
        NODE_ENV: 'test',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: address.port,
        SMTP_SECURE: 'false',
        SMTP_FROM: 'sender@example.test',
        EXTERNAL_SIGNING_ORIGIN: 'http://localhost:3000',
      }),
    );
    const result = await sender.sendInternalGroup({
      recipientEmails: [
        'accepted@example.test',
        'temporary@example.test',
        'permanent@example.test',
      ],
      documentTitle: '合成文件',
      creatorName: '人資',
      signEndAt: new Date('2027-01-01'),
      portalLoginUrl:
        'http://portal.feastogether.com.tw/portal/login?redirect_to=hr/esign/mine',
    });
    expect(result).toEqual([
      {
        recipientEmail: 'accepted@example.test',
        status: 'accepted',
        retryable: false,
      },
      {
        recipientEmail: 'temporary@example.test',
        status: 'rejected',
        retryable: true,
      },
      {
        recipientEmail: 'permanent@example.test',
        status: 'rejected',
        retryable: false,
      },
    ]);
    expect(recipients).toEqual([
      'accepted@example.test',
      'temporary@example.test',
      'permanent@example.test',
    ]);
    expect(message).not.toMatch(/^(To|Cc|Bcc):/im);
    expect(message).not.toMatch(
      /accepted@example|temporary@example|permanent@example/,
    );
    expect(message).toContain('portal.feastogether.com.tw');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('SMTP 已完整收到 DATA 但未回250就關線：結果為 unknown，不能自動重試', async () => {
  let dataReceived = false;
  let message = '';
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 local.test ESMTP\r\n');
    let pending = '';
    let data = false;
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      while (pending.includes('\r\n')) {
        const index = pending.indexOf('\r\n');
        const line = pending.slice(0, index);
        pending = pending.slice(index + 2);
        if (data) {
          if (line === '.') {
            dataReceived = true;
            // 模擬服務端可能已接受文件，但250回應遺失。
            socket.destroy();
          } else message += line + '\r\n';
        } else if (line === 'DATA') {
          data = true;
          socket.write('354 continue\r\n');
        } else socket.write('250 local.test\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('測試 SMTP 未啟動');
    const sender = new SmtpInvitationMailSender(
      new ConfigService({
        NODE_ENV: 'test',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: address.port,
        SMTP_SECURE: 'false',
        SMTP_FROM: 'sender@example.test',
        EXTERNAL_SIGNING_ORIGIN: 'http://localhost:3000',
      }),
    );
    const result = await sender.sendInternalGroup({
      recipientEmails: ['employee@example.test'],
      documentTitle: '合成文件',
      creatorName: '人資',
      signEndAt: new Date('2027-01-01'),
      portalLoginUrl:
        'http://portal.feastogether.com.tw/portal/login?redirect_to=hr/esign/mine',
    });
    expect(dataReceived).toBe(true);
    expect(message).toContain('portal.feastogether.com.tw');
    expect(result).toEqual([
      {
        recipientEmail: 'employee@example.test',
        status: 'unknown',
        retryable: false,
      },
    ]);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
