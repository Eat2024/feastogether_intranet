import { escapeHtml } from '#app/common/escape-html';
import type {
  SendInvitationMailInput,
  SendOtpMailInput,
} from './invitation-mail-sender.port';

export interface InvitationMailContent {
  subject: string;
  text: string;
  html: string;
}

export function buildInvitationMail(
  input: SendInvitationMailInput,
  externalOrigin: string,
): InvitationMailContent {
  const deadline = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'long',
    timeStyle: 'short',
    hour12: false,
  }).format(input.signEndAt);
  const url = `${externalOrigin}/api/external-signature-invitations/${encodeURIComponent(input.invitationToken)}`;
  const subject = `電子簽署邀請：${input.documentTitle}`;
  const lines = [
    `您收到 ${input.creatorName} 發起的電子簽署邀請。`,
    `文件：${input.documentTitle}`,
    `簽署期限（台北時間）：${deadline}`,
    `開啟邀請：${url}`,
    '此連結僅供指定簽署人使用，請勿轉寄。',
  ];
  return {
    subject,
    text: lines.join('\n'),
    html: `<p>您收到 ${escapeHtml(input.creatorName)} 發起的電子簽署邀請。</p><p>文件：${escapeHtml(input.documentTitle)}</p><p>簽署期限（台北時間）：${escapeHtml(deadline)}</p><p><a href="${escapeHtml(url)}">開啟簽署邀請</a></p><p>此連結僅供指定簽署人使用，請勿轉寄。</p>`,
  };
}

/** 驗證碼信只含驗證碼、有效時間、文件名稱與非本人操作提醒，不含任何連結。 */
export function buildOtpMail(input: SendOtpMailInput): InvitationMailContent {
  const lines = [
    `您的電子簽署驗證碼：${input.code}`,
    '10 分鐘內有效，只能使用一次。',
    `文件：${input.documentTitle}`,
    '若非本人操作請忽略此信，請勿將驗證碼提供給他人。',
  ];
  return {
    subject: '電子簽署驗證碼',
    text: lines.join('\n'),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
  };
}
