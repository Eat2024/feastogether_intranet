import {
  invitationConfirmPage,
  invitationInvalidPage,
  otpInputPage,
  otpMailFailedPage,
  otpRejectedPage,
  serviceUnavailablePage,
  signingNotStartedPage,
} from './external-invitation-page';

describe('外部簽署邀請頁', () => {
  const token = 'A'.repeat(43);

  it('邀請確認頁以表單送出 token 寄出驗證碼，並提醒勿轉寄與期限', () => {
    const html = invitationConfirmPage(token);

    expect(html).toContain('<h1');
    expect(html).toContain('電子簽署邀請</h1>');
    expect(html).toContain(
      '您收到一份需要簽署的文件，開啟後即可閱讀內容並完成簽名。',
    );
    expect(html).toContain(
      '<form method="post" action="/api/external-signature-otps"',
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

  it('尚未開始頁以台北時間告知開始時間，提醒勿轉寄，不提供開啟表單', () => {
    const html = signingNotStartedPage(new Date('2026-10-24T16:00:00.000Z'));

    expect(html).toContain('簽署尚未開始</h1>');
    expect(html).toContain(
      '請於 2026/10/25 00:00（台北時間）後簽署，屆時再開啟邀請信中的連結即可。',
    );
    expect(html).toContain('此連結僅供受邀的簽署人本人使用，請勿轉寄。');
    expect(html).not.toContain('<form');
  });

  it('驗證碼輸入頁顯示遮罩後的信箱與有效時間，以表單送出 token 與 6 位數驗證碼', () => {
    const html = otpInputPage(token, 'daming.wang@example.com');

    expect(html).toContain('輸入驗證碼</h1>');
    expect(html).toContain('驗證碼已寄到 d***@example.com，10 分鐘內有效。');
    expect(html).not.toContain('daming.wang');
    expect(html).toContain(
      '<form method="post" action="/api/external-signature-session"',
    );
    expect(html).toContain(
      `<input type="hidden" name="token" value="${token}">`,
    );
    expect(html).toMatch(/<label for="otp-code">6 位數驗證碼<\/label>/);
    const input = /<input id="otp-code"[^>]*>/.exec(html)?.[0] ?? '';
    for (const attribute of [
      'name="code"',
      'inputmode="numeric"',
      'autocomplete="one-time-code"',
      'pattern="[0-9]{6}"',
      'maxlength="6"',
      'required',
    ]) {
      expect(input).toContain(attribute);
    }
    expect(input).not.toContain('aria-invalid');
    expect(html).not.toContain('role="alert"');
    expect(html).toMatch(/<button type="submit"[^>]*>驗證並開啟文件<\/button>/);
    expect(html).toContain(
      '沒收到信？請檢查垃圾郵件。驗證碼只能使用一次，請勿提供給他人。',
    );
  });

  it('驗證碼錯誤頁標示輸入框錯誤並顯示剩餘次數，不回填輸入內容', () => {
    const html = otpRejectedPage(token, 'daming.wang@example.com', 3);

    expect(html).toContain('驗證碼已寄到 d***@example.com，10 分鐘內有效。');
    expect(html).toMatch(
      /<input id="otp-code"[^>]*aria-invalid="true" aria-describedby="otp-error"/,
    );
    expect(html).toContain(
      '<span id="otp-error" role="alert">驗證碼錯誤，還可以再試 3 次。</span>',
    );
    expect(html).not.toMatch(/<input id="otp-code"[^>]*value=/);
    expect(html).toContain(
      '錯誤 5 次或超過 10 分鐘，驗證碼即失效，請重新開啟邀請信中的連結。',
    );
  });

  it('驗證碼已失效時提示重新開啟邀請信中的連結', () => {
    const html = otpRejectedPage(token, 'daming.wang@example.com', 0);

    expect(html).toContain(
      '<span id="otp-error" role="alert">驗證碼已失效，請重新開啟邀請信中的連結，取得新的驗證碼。</span>',
    );
  });

  it('信箱經 HTML 跳脫後才顯示', () => {
    const html = otpInputPage(token, '<b>@example.com');

    expect(html).toContain('驗證碼已寄到 &lt;***@example.com');
    expect(html).not.toContain('<b>');
  });

  it('驗證碼寄送失敗頁請簽署人稍後重試，不提供表單', () => {
    const html = otpMailFailedPage();

    expect(html).toContain('驗證碼寄送失敗</h1>');
    expect(html).toContain('驗證碼寄送失敗，請稍後再開啟邀請信中的連結重試。');
    expect(html).not.toContain('<form');
  });

  it.each([
    ['邀請確認頁', invitationConfirmPage(token)],
    ['驗證碼輸入頁', otpInputPage(token, 'daming.wang@example.com')],
    ['驗證碼錯誤頁', otpRejectedPage(token, 'daming.wang@example.com', 1)],
    ['驗證碼寄送失敗頁', otpMailFailedPage()],
    ['失效頁', invitationInvalidPage()],
    ['服務暫停頁', serviceUnavailablePage()],
    ['尚未開始頁', signingNotStartedPage(new Date())],
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
