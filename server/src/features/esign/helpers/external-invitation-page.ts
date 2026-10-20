import { createHash } from 'node:crypto';
import { formatInTaipei } from '#app/common/date-time.helper';
import { escapeHtml } from '#app/common/escape-html';
import type { OtpIssue } from '../services/external-otp.service';

/*
 * 外部簽署人取得存取前由後端直接回應的頁面，版型依設計稿 docs/design/008-external-signing-flow。
 * 回應帶 INVITATION_PAGE_CSP：只用內嵌樣式（手機版面需要 media query）、inline SVG 與系統字型，
 * 不引用任何外部資源；script 只有重新寄送倒數一段，以內容雜湊放行。
 */

/**
 * 重新寄送按鈕的倒數：從伺服器給的 data-wait 秒數倒數，到時啟用按鈕。
 * 以截止時刻計算剩餘秒數，手機切到信箱 App 時計時器暫停也不會失準。
 */
const RESEND_COUNTDOWN_SCRIPT = [
  "const button=document.getElementById('otp-resend');",
  'const end=Date.now()+Number(button.dataset.wait)*1000;',
  'const timer=setInterval(()=>{',
  'const seconds=Math.ceil((end-Date.now())/1000);',
  "if(seconds>0){button.textContent='重新寄送驗證碼（'+seconds+' 秒後）';return}",
  "clearInterval(timer);button.disabled=false;button.textContent='重新寄送驗證碼'",
  '},1000);',
].join('');

/** 邀請頁的 CSP：script 只放行上面那段固定內容的 SHA-256。 */
export const INVITATION_PAGE_CSP = [
  "default-src 'none'",
  `script-src 'sha256-${createHash('sha256').update(RESEND_COUNTDOWN_SCRIPT).digest('base64')}'`,
  "style-src 'unsafe-inline'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** 卡片圖示：MUI Rounded 圖示的 SVG path 與顏色。 */
const ICONS = {
  // DrawRounded
  invitation: {
    color: '#1976D2',
    path: 'm18.85 10.39 1.06-1.06c.78-.78.78-2.05 0-2.83L18.5 5.09c-.78-.78-2.05-.78-2.83 0l-1.06 1.06zm-5.66-2.83-9.05 9.05c-.09.09-.14.22-.14.35v3.54c0 .28.22.5.5.5h3.54c.13 0 .26-.05.35-.15l9.05-9.05zM19 17.5c0 2.19-2.54 3.5-5 3.5-.55 0-1-.45-1-1s.45-1 1-1c1.54 0 3-.73 3-1.5 0-.47-.48-.87-1.23-1.2l1.48-1.48c1.07.63 1.75 1.47 1.75 2.68M4.58 13.35C3.61 12.79 3 12.06 3 11c0-1.8 1.89-2.63 3.56-3.36C7.59 7.18 9 6.56 9 6c0-.41-.78-1-2-1-1.26 0-1.8.61-1.83.64-.35.41-.98.46-1.4.12-.41-.34-.49-.95-.15-1.38C3.73 4.24 4.76 3 7 3s4 1.32 4 3c0 1.87-1.93 2.72-3.64 3.47C6.42 9.88 5 10.5 5 11c0 .31.43.6 1.07.86z',
  },
  // ScheduleRounded
  notStarted: {
    color: '#1976D2',
    path: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m-.22-13h-.06c-.4 0-.72.32-.72.72v4.72c0 .35.18.68.49.86l4.15 2.49c.34.2.78.1.98-.24.21-.34.1-.79-.25-.99l-3.87-2.3V7.72c0-.4-.32-.72-.72-.72',
  },
  // LinkOffRounded
  invalid: {
    color: '#FF5254',
    path: 'M14 9h2.87c1.46 0 2.8.98 3.08 2.42.31 1.64-.74 3.11-2.22 3.48l1.53 1.53c1.77-.91 2.95-2.82 2.7-5.01C21.68 8.86 19.37 7 16.79 7H14c-.55 0-1 .45-1 1s.45 1 1 1M3.51 3.51a.996.996 0 0 0-1.41 0c-.39.39-.39 1.02 0 1.41l2.64 2.64c-1.77.91-2.95 2.82-2.7 5.01C2.32 15.14 4.63 17 7.21 17H10c.55 0 1-.45 1-1s-.45-1-1-1H7.13c-1.46 0-2.8-.98-3.08-2.42-.31-1.64.75-3.11 2.22-3.48l2.12 2.12c-.23.19-.39.46-.39.78 0 .55.45 1 1 1h1.17l8.9 8.9c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41zM14 11l1.71 1.71c.18-.18.29-.43.29-.71 0-.55-.45-1-1-1z',
  },
  // MarkEmailReadRounded
  otp: {
    color: '#1976D2',
    path: 'M18.05 21.29c-.39.39-1.02.39-1.41 0l-2.12-2.12a.996.996 0 0 1 0-1.41c.39-.39 1.02-.39 1.41 0l1.41 1.41 3.54-3.54c.39-.39 1.02-.39 1.41 0s.39 1.02 0 1.41zM12.08 20H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2v6.68c-.91-.43-1.92-.68-3-.68-3.87 0-7 3.13-7 7 0 .34.03.67.08 1m-.61-7.33c.32.2.74.2 1.06 0l7.07-4.42c.25-.16.4-.43.4-.72 0-.67-.73-1.07-1.3-.72L12 11 5.3 6.81c-.57-.35-1.3.05-1.3.72 0 .29.15.56.4.72z',
  },
  // CloudOffRounded
  unavailable: {
    color: '#FF951C',
    path: 'M24 15c0-2.64-2.05-4.78-4.65-4.96C18.67 6.59 15.64 4 12 4c-1.33 0-2.57.36-3.65.97l1.49 1.49C10.51 6.17 11.23 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3 0 .99-.48 1.85-1.21 2.4l1.41 1.41c1.09-.92 1.8-2.27 1.8-3.81M3.71 4.56c-.39.39-.39 1.02 0 1.41l2.06 2.06h-.42c-3.28.35-5.76 3.34-5.29 6.79C.46 17.84 3.19 20 6.22 20h11.51l1.29 1.29c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41L5.12 4.56a.996.996 0 0 0-1.41 0M6 18c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73l8 8z',
  },
} as const;

/** 卡片內的表單；兩種表單都以 hidden 欄位帶邀請 token，不放進網址。 */
type PageForm =
  /** 「開啟電子簽署文件」：寄出驗證碼 */
  | { kind: 'open'; token: string }
  /**
   * 輸入驗證碼建立存取，同一表單附「重新寄送驗證碼」。resendWaitSeconds 大於 0 時重新寄送按鈕停用並倒數；
   * error 有值時標示輸入錯誤；notice 說明寄送受限（429）。
   */
  | {
      kind: 'otp';
      token: string;
      resendWaitSeconds: number;
      error?: string;
      notice?: string;
    };

interface ExternalPage {
  icon: keyof typeof ICONS;
  title: string;
  description: string;
  form?: PageForm;
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
  'form{width:100%;margin:16px 0 0;display:flex;flex-direction:column;gap:8px}',
  // 驗證碼輸入框：MUI outlined TextField 樣式，聚焦時框線轉藍、錯誤時轉紅
  '.field{display:flex;flex-direction:column;gap:4px;text-align:left}',
  '.box{position:relative;height:56px;box-sizing:border-box;border:1px solid rgba(0,0,0,0.23);border-radius:4px;display:flex;align-items:center;padding:0 14px}',
  'label{position:absolute;top:-10px;left:10px;padding:0 4px;background:#FFFFFF;font-size:12px;line-height:1.7;color:#757575}',
  '#otp-code{width:100%;border:0;outline:none;background:transparent;font:inherit;font-size:20px;letter-spacing:8px;text-align:center;color:#212121}',
  '.box:focus-within{border:2px solid #1976D2;padding:0 13px}.box:focus-within label{color:#1976D2}',
  '.error .box{border:2px solid #FF5254;padding:0 13px}.error label{color:#D94647}',
  '#otp-error{padding:0 14px;font-size:12px;line-height:1.7;color:#D94647}',
  'button{width:100%;height:42px;padding:0 22px;border:0;border-radius:4px;background:#1976D2;color:#FFFFFF;font:inherit;font-size:14px;font-weight:500;box-shadow:0 3px 1px -2px rgba(0,0,0,0.2),0 2px 2px 0 rgba(0,0,0,0.14),0 1px 5px 0 rgba(0,0,0,0.12);cursor:pointer}',
  'button:hover{background:#1565C0}',
  // 重新寄送：MUI text button，停用時轉灰
  'button.text{background:transparent;color:#1976D2;box-shadow:none}button.text:hover{background:rgba(25,118,210,0.04)}',
  'button.text:disabled{background:transparent;color:rgba(0,0,0,0.38);cursor:default}',
  '#otp-notice{font-size:14px;color:#D94647}',
  // 手機寬度：較矮的頁首，卡片滿版並改靠上；驗證碼卡片較高，上方留白較少
  '@media (max-width:599.95px){header{height:56px;padding:0 16px}main{align-items:flex-start;padding:160px 16px 16px}main.otp{padding-top:120px}section{width:100%}}',
].join('');

/** 所有動態值都在這裡跳脫，呼叫端只傳純文字。 */
function renderPage(page: ExternalPage): string {
  const icon = ICONS[page.icon];
  const title = escapeHtml(page.title);
  const form = page.form ? renderForm(page.form) : '';
  const notes = page.notes?.length
    ? `<p class="note">${page.notes.map(escapeHtml).join('<br>')}</p>`
    : '';
  const main = page.form?.kind === 'otp' ? '<main class="otp">' : '<main>';
  return (
    '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    `<title>${title}</title><style>${STYLE}</style></head><body>` +
    `<header>電子簽署</header>${main}<section>` +
    `<svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true"><path fill="${icon.color}" d="${icon.path}"></path></svg>` +
    `<h1>${title}</h1><p>${escapeHtml(page.description)}</p>${form}${notes}` +
    '</section></main></body></html>'
  );
}

function renderForm(form: PageForm): string {
  const token = `<input type="hidden" name="token" value="${escapeHtml(form.token)}">`;
  if (form.kind === 'open') {
    return (
      `<form method="post" action="/api/external-signature-otps">${token}` +
      '<button type="submit">開啟電子簽署文件</button></form>'
    );
  }
  const error =
    form.error === undefined
      ? { field: '', input: '', message: '' }
      : {
          field: ' error',
          input: ' aria-invalid="true" aria-describedby="otp-error"',
          message: `<span id="otp-error" role="alert">${escapeHtml(form.error)}</span>`,
        };
  const notice = form.notice
    ? `<p id="otp-notice" role="alert">${escapeHtml(form.notice)}</p>`
    : '';
  return (
    `<form method="post" action="/api/external-signature-session">${token}` +
    `<div class="field${error.field}"><div class="box"><label for="otp-code">6 位數驗證碼</label>` +
    '<input id="otp-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"' +
    `${error.input}></div>${error.message}</div>` +
    `<button type="submit">驗證並開啟文件</button>${resendButton(form.resendWaitSeconds)}${notice}</form>`
  );
}

/** 重新寄送改送 otps 端點（同表單的 hidden token），不檢查驗證碼欄位；冷卻中停用並倒數。 */
function resendButton(waitSeconds: number): string {
  const attributes =
    'type="submit" class="text" formaction="/api/external-signature-otps" formnovalidate';
  if (waitSeconds <= 0) return `<button ${attributes}>重新寄送驗證碼</button>`;
  return (
    `<button ${attributes} id="otp-resend" disabled data-wait="${waitSeconds}">重新寄送驗證碼（${waitSeconds} 秒後）</button>` +
    `<script>${RESEND_COUNTDOWN_SCRIPT}</script>`
  );
}

/** 只露出帳號第一個字元與網域：daming.wang@example.com → d***@example.com */
function maskEmail(email: string): string {
  return `${email.slice(0, 1)}***${email.slice(email.lastIndexOf('@'))}`;
}

/** 邀請確認頁：只呈現開啟按鈕，按下後才驗證邀請並寄出驗證碼。 */
export function invitationConfirmPage(token: string): string {
  return renderPage({
    icon: 'invitation',
    title: '電子簽署邀請',
    description: '您收到一份需要簽署的文件，開啟後即可閱讀內容並完成簽名。',
    form: { kind: 'open', token },
    notes: [
      '此連結僅供受邀的簽署人本人使用，請勿轉寄。',
      '請於邀請信所列的簽署期限前完成，逾期即失效。',
    ],
  });
}

/**
 * 驗證碼輸入頁：寄出驗證碼後顯示，重新寄送按鈕倒數冷卻秒數。冷卻中或已達每小時上限（429）時未寄新驗證碼，
 * 同頁說明可再寄送的時間，先前寄出的驗證碼仍可輸入。
 */
export function otpInputPage(
  token: string,
  email: string,
  issue: OtpIssue,
): string {
  return renderPage({
    icon: 'otp',
    title: '輸入驗證碼',
    description: `驗證碼已寄到 ${maskEmail(email)}，10 分鐘內有效。`,
    form: {
      kind: 'otp',
      token,
      // 每小時上限可能要等數十分鐘：按鈕不倒數，改以 notice 說明可再寄送的時刻
      resendWaitSeconds:
        issue.status === 'hourly-limit' ? 0 : issue.retryAfterSeconds,
      notice: resendLimitNotice(issue),
    },
    notes: ['沒收到信？請檢查垃圾郵件。驗證碼只能使用一次，請勿提供給他人。'],
  });
}

/** 寄送受限的說明；每小時上限的時刻（台北時間）無條件進位到分鐘，照著時刻重試不會太早。 */
function resendLimitNotice(issue: OtpIssue): string | undefined {
  if (issue.status === 'cooldown')
    return `請於 ${issue.retryAfterSeconds} 秒後再重新寄送。`;
  if (issue.status === 'hourly-limit') {
    const minute = 60_000;
    const retryAt =
      Math.ceil((Date.now() + issue.retryAfterSeconds * 1000) / minute) *
      minute;
    return `寄送次數已達上限，請於 ${formatInTaipei(retryAt, 'HH:mm')} 後再試。`;
  }
  return undefined;
}

/** 驗證碼錯誤頁：remainingAttempts 為 0 表示驗證碼已失效（過期、已使用或錯滿）。 */
export function otpRejectedPage(
  token: string,
  email: string,
  remainingAttempts: number,
): string {
  return renderPage({
    icon: 'otp',
    title: '輸入驗證碼',
    description: `驗證碼已寄到 ${maskEmail(email)}，10 分鐘內有效。`,
    form: {
      kind: 'otp',
      token,
      // 冷卻與上限由 otps 端點判斷，錯誤頁的重新寄送一律可按
      resendWaitSeconds: 0,
      error:
        remainingAttempts > 0
          ? `驗證碼錯誤，還可以再試 ${remainingAttempts} 次。`
          : '驗證碼已失效，請重新寄送。',
    },
    notes: ['錯誤 5 次或超過 10 分鐘，驗證碼即失效，請重新寄送。'],
  });
}

/** 驗證碼寄送失敗頁：未保留驗證碼，稍後重新開啟即可再寄送。 */
export function otpMailFailedPage(): string {
  return renderPage({
    icon: 'unavailable',
    title: '驗證碼寄送失敗',
    description: '驗證碼寄送失敗，請稍後再開啟邀請信中的連結重試。',
  });
}

/** 尚未開始頁：只給有效邀請的待簽者，告知開始時間（台北時間），開始後用同一連結即可簽署。 */
export function signingNotStartedPage(startAt: Date): string {
  return renderPage({
    icon: 'notStarted',
    title: '簽署尚未開始',
    description: `請於 ${formatInTaipei(startAt, 'yyyy/MM/dd HH:mm')}（台北時間）後簽署，屆時再開啟邀請信中的連結即可。`,
    notes: ['此連結僅供受邀的簽署人本人使用，請勿轉寄。'],
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
