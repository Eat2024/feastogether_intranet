// Email 簽署人（未列入組織架構的同仁）的共用規則：畫面與伺服器端使用同一套檢查。

/** 以 Email 加入的簽署人，其 id 為此前綴＋小寫 email */
export const EMAIL_SIGNER_PREFIX = 'email:';

// 與後端 class-validator @IsEmail() 一致的常見規則（避免畫面通過、發起時才被後端拒絕）：
// - 帳號：英數字與 . _ % + - ' 等常用符號，不可以點開頭或結尾、不可連續兩個點，最多 64 字
// - 網域：每一段為英數字與連字號（不可以連字號開頭或結尾），段與段以單一個點分隔
// - 最後一段（頂級網域）至少 2 個英文字母，例如 .com、.tw
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TLD = /^[A-Za-z]{2,63}$/;
export const MAX_EMAIL_LENGTH = 254;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function isValidEmail(email: string) {
  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH) return false;
  const at = email.lastIndexOf('@');
  if (at <= 0 || email.indexOf('@') !== at) return false;
  const local = email.slice(0, at);
  const labels = email.slice(at + 1).split('.');
  return (
    local.length <= 64 &&
    LOCAL_PART.test(local) &&
    labels.length >= 2 &&
    labels.every((l) => DOMAIN_LABEL.test(l)) &&
    TLD.test(labels[labels.length - 1])
  );
}

export const emailSignerId = (email: string) => `${EMAIL_SIGNER_PREFIX}${normalizeEmail(email)}`;
export const isEmailSignerId = (id: string) => id.startsWith(EMAIL_SIGNER_PREFIX);
