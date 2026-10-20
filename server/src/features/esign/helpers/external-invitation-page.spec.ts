import {
  invitationConfirmPage,
  invitationInvalidPage,
  serviceUnavailablePage,
} from './external-invitation-page';

describe('外部簽署邀請頁', () => {
  const token = 'A'.repeat(43);

  it('邀請確認頁以表單送出 token 建立存取，並提醒勿轉寄與期限', () => {
    const html = invitationConfirmPage(token);

    expect(html).toContain('<h1');
    expect(html).toContain('電子簽署邀請</h1>');
    expect(html).toContain(
      '您收到一份需要簽署的文件，開啟後即可閱讀內容並完成簽名。',
    );
    expect(html).toContain(
      '<form method="post" action="/api/external-signature-session"',
    );
    expect(html).toContain(
      `<input type="hidden" name="token" value="${token}">`,
    );
    expect(html).toMatch(
      /<button type="submit"[^>]*>開啟電子簽署文件<\/button>/,
    );
    expect(html).toContain(
      '此連結僅供受邀的簽署人本人使用，請勿轉寄。<br>請於邀請信所列的簽署期限前完成，逾期即失效。',
    );
  });

  it('token 經 HTML 跳脫，無法跳出屬性或插入標籤', () => {
    const html = invitationConfirmPage(`"><script>alert('x')</script>&`);

    expect(html).toContain(
      'value="&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;"',
    );
    expect(html).not.toContain('<script');
  });

  it('失效頁提示聯絡發起人並列出可能原因，不提供開啟表單', () => {
    const html = invitationInvalidPage();

    expect(html).toContain('邀請連結無效或已到期</h1>');
    expect(html).toContain(
      '如仍需要簽署這份文件，請聯絡文件發起人重新寄送邀請。',
    );
    expect(html).toContain(
      '可能原因：已超過簽署期限、文件已停止簽署，或網址不完整。',
    );
    expect(html).not.toContain('<form');
  });

  it('服務暫停頁請簽署人稍後再開啟同一連結', () => {
    const html = serviceUnavailablePage();

    expect(html).toContain('服務暫時無法使用</h1>');
    expect(html).toContain(
      '電子簽署服務暫時無法使用，請稍後再開啟邀請信中的連結。',
    );
    expect(html).not.toContain('<form');
  });

  it.each([
    ['邀請確認頁', invitationConfirmPage(token)],
    ['失效頁', invitationInvalidPage()],
    ['服務暫停頁', serviceUnavailablePage()],
  ])('%s支援手機寬度，只用系統字型且不載入外部資源', (_name, html) => {
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    expect(html).toContain('<header>電子簽署</header>');
    expect(html).toContain(
      "font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif",
    );
    expect(html).not.toMatch(/https?:|<link|<script|<img|@import|url\(/i);
  });
});
