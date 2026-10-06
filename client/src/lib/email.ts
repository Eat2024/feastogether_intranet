// Email 簽署人（未列入組織架構的同仁）的共用規則：畫面與伺服器端使用同一套檢查。

/** 以 Email 加入的簽署人，其 id 為此前綴＋小寫 email */
export const EMAIL_SIGNER_PREFIX = 'email:';

// 實務上足夠的格式檢查：name@domain.tld，不含空白
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LENGTH = 254;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function isValidEmail(email: string) {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

export const emailSignerId = (email: string) => `${EMAIL_SIGNER_PREFIX}${normalizeEmail(email)}`;
export const isEmailSignerId = (id: string) => id.startsWith(EMAIL_SIGNER_PREFIX);
