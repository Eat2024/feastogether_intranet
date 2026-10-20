import { escapeHtml } from '#app/common/escape-html';

/*
 * 外部簽署人取得存取前由後端直接回應的頁面，版型依設計稿 docs/design/008-external-signing-flow。
 * 回應帶 CSP default-src 'none'、style-src 'unsafe-inline'：只用內嵌樣式（手機版面需要 media query）、
 * inline SVG 與系統字型，不引用任何外部資源。
 */

/** 卡片圖示：MUI Rounded 圖示的 SVG path 與顏色。 */
const ICONS = {
  // DrawRounded
  invitation: {
    color: '#1976D2',
    path: 'm18.85 10.39 1.06-1.06c.78-.78.78-2.05 0-2.83L18.5 5.09c-.78-.78-2.05-.78-2.83 0l-1.06 1.06zm-5.66-2.83-9.05 9.05c-.09.09-.14.22-.14.35v3.54c0 .28.22.5.5.5h3.54c.13 0 .26-.05.35-.15l9.05-9.05zM19 17.5c0 2.19-2.54 3.5-5 3.5-.55 0-1-.45-1-1s.45-1 1-1c1.54 0 3-.73 3-1.5 0-.47-.48-.87-1.23-1.2l1.48-1.48c1.07.63 1.75 1.47 1.75 2.68M4.58 13.35C3.61 12.79 3 12.06 3 11c0-1.8 1.89-2.63 3.56-3.36C7.59 7.18 9 6.56 9 6c0-.41-.78-1-2-1-1.26 0-1.8.61-1.83.64-.35.41-.98.46-1.4.12-.41-.34-.49-.95-.15-1.38C3.73 4.24 4.76 3 7 3s4 1.32 4 3c0 1.87-1.93 2.72-3.64 3.47C6.42 9.88 5 10.5 5 11c0 .31.43.6 1.07.86z',
  },
  // LinkOffRounded
  invalid: {
    color: '#FF5254',
    path: 'M14 9h2.87c1.46 0 2.8.98 3.08 2.42.31 1.64-.74 3.11-2.22 3.48l1.53 1.53c1.77-.91 2.95-2.82 2.7-5.01C21.68 8.86 19.37 7 16.79 7H14c-.55 0-1 .45-1 1s.45 1 1 1M3.51 3.51a.996.996 0 0 0-1.41 0c-.39.39-.39 1.02 0 1.41l2.64 2.64c-1.77.91-2.95 2.82-2.7 5.01C2.32 15.14 4.63 17 7.21 17H10c.55 0 1-.45 1-1s-.45-1-1-1H7.13c-1.46 0-2.8-.98-3.08-2.42-.31-1.64.75-3.11 2.22-3.48l2.12 2.12c-.23.19-.39.46-.39.78 0 .55.45 1 1 1h1.17l8.9 8.9c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41zM14 11l1.71 1.71c.18-.18.29-.43.29-.71 0-.55-.45-1-1-1z',
  },
  // CloudOffRounded
  unavailable: {
    color: '#FF951C',
    path: 'M24 15c0-2.64-2.05-4.78-4.65-4.96C18.67 6.59 15.64 4 12 4c-1.33 0-2.57.36-3.65.97l1.49 1.49C10.51 6.17 11.23 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3 0 .99-.48 1.85-1.21 2.4l1.41 1.41c1.09-.92 1.8-2.27 1.8-3.81M3.71 4.56c-.39.39-.39 1.02 0 1.41l2.06 2.06h-.42c-3.28.35-5.76 3.34-5.29 6.79C.46 17.84 3.19 20 6.22 20h11.51l1.29 1.29c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41L5.12 4.56a.996.996 0 0 0-1.41 0M6 18c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73l8 8z',
  },
} as const;

interface ExternalPage {
  icon: keyof typeof ICONS;
  title: string;
  description: string;
  /** 有值時顯示「開啟電子簽署文件」表單，送出此邀請 token 建立存取。 */
  invitationToken?: string;
  /** 卡片底部的小字提醒，一則一行。 */
  notes?: readonly string[];
}

const STYLE = [
  "body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:#F3F5F6;color:#212121;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif}",
  'header{height:64px;flex:none;display:flex;align-items:center;padding:0 24px;background:#202229;color:#FFFFFF;font-size:20px;font-weight:700;line-height:1.25}',
  'main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px}',
  'section{width:360px;max-width:100%;box-sizing:border-box;padding:24px;background:#FFFFFF;border-radius:16px;box-shadow:0 0 10px rgba(0,0,0,0.125);display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}',
  'h1{margin:0;font-size:20px;font-weight:700;line-height:1.25;color:#424242}',
  'p{margin:0;font-size:16px;line-height:1.7;color:#757575}',
  '.note{margin-top:8px;font-size:12px}',
  'form{width:100%;margin:16px 0 0}',
  'button{width:100%;height:42px;padding:0 22px;border:0;border-radius:4px;background:#1976D2;color:#FFFFFF;font:inherit;font-size:14px;font-weight:500;box-shadow:0 3px 1px -2px rgba(0,0,0,0.2),0 2px 2px 0 rgba(0,0,0,0.14),0 1px 5px 0 rgba(0,0,0,0.12);cursor:pointer}',
  'button:hover{background:#1565C0}',
  // 手機寬度：較矮的頁首，卡片滿版並改靠上
  '@media (max-width:599.95px){header{height:56px;padding:0 16px}main{align-items:flex-start;padding:160px 16px 16px}section{width:100%}}',
].join('');

/** 所有動態值都在這裡跳脫，呼叫端只傳純文字。 */
function renderPage(page: ExternalPage): string {
  const icon = ICONS[page.icon];
  const title = escapeHtml(page.title);
  const form =
    page.invitationToken === undefined
      ? ''
      : '<form method="post" action="/api/external-signature-session">' +
        `<input type="hidden" name="token" value="${escapeHtml(page.invitationToken)}">` +
        '<button type="submit">開啟電子簽署文件</button></form>';
  const notes = page.notes?.length
    ? `<p class="note">${page.notes.map(escapeHtml).join('<br>')}</p>`
    : '';
  return (
    '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    `<title>${title}</title><style>${STYLE}</style></head><body>` +
    '<header>電子簽署</header><main><section>' +
    `<svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true"><path fill="${icon.color}" d="${icon.path}"></path></svg>` +
    `<h1>${title}</h1><p>${escapeHtml(page.description)}</p>${form}${notes}` +
    '</section></main></body></html>'
  );
}

/** 邀請確認頁：只呈現開啟按鈕，按下後才驗證邀請並建立存取。 */
export function invitationConfirmPage(token: string): string {
  return renderPage({
    icon: 'invitation',
    title: '電子簽署邀請',
    description: '您收到一份需要簽署的文件，開啟後即可閱讀內容並完成簽名。',
    invitationToken: token,
    notes: [
      '此連結僅供受邀的簽署人本人使用，請勿轉寄。',
      '請於邀請信所列的簽署期限前完成，逾期即失效。',
    ],
  });
}

/** 失效頁：無效、過期、已停止與格式錯誤都顯示相同內容，不揭露是哪一種原因。 */
export function invitationInvalidPage(): string {
  return renderPage({
    icon: 'invalid',
    title: '邀請連結無效或已到期',
    description: '如仍需要簽署這份文件，請聯絡文件發起人重新寄送邀請。',
    notes: ['可能原因：已超過簽署期限、文件已停止簽署，或網址不完整。'],
  });
}

/** 服務暫停頁：資料庫等依賴暫時無法使用，邀請本身可能仍有效。 */
export function serviceUnavailablePage(): string {
  return renderPage({
    icon: 'unavailable',
    title: '服務暫時無法使用',
    description: '電子簽署服務暫時無法使用，請稍後再開啟邀請信中的連結。',
  });
}
