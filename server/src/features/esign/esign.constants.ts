/** 內部通知與舊入口共用；UAT 與正式環境均導向正式 Portal。 */
export const INTERNAL_PORTAL_LOGIN_URL =
  'http://portal.feastogether.com.tw/portal/login?redirect_to=hr/esign/mine';
/** 每封內部通知的不同 BCC 地址上限。 */
export const INTERNAL_NOTIFICATION_RECIPIENT_LIMIT = 50;
