// API 路徑常數（controller 根路徑）；新增 feature 時於此登記，避免字串散落。
export default {
  HEALTH: 'health',
  AUTH: 'auth',
  ROLES: 'roles',
  USERS: 'users',
  // ── 038 饗賓 OAuth 登入：POST /auth/oauth/start、POST /auth/oauth/callback ──
  AUTH_OAUTH: 'auth/oauth',
  AUTH_OAUTH_START: 'start',
  AUTH_OAUTH_CALLBACK: 'callback',
  // GET /auth/login-options：登入頁依設定顯示可用入口；POST /auth/dev-login：DEVMOD 開發者登入
  AUTH_LOGIN_OPTIONS: 'login-options',
  AUTH_DEV_LOGIN: 'dev-login',
} as const;
