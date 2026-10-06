// openid-client 測試替身（038）。
//
// openid-client@6 為 ESM-only；Node ≥20.19 的 require(esm) 可載入，但 Jest 的 CJS
// 模組系統不能直接解析，故 unit／e2e 的 jest 設定皆以 moduleNameMapper 將
// `openid-client` 對應到本檔。測試只驗本系統這一側的協調邏輯（交易、身分綁定、
// session、登出語意）；協定與驗簽交給套件本身，真套件是否能在目前 runtime 載入
// 由 test/oauth-runtime.e2e-spec.ts 以獨立 Node 程序 smoke 驗證。
//
// 用法：e2e 於 beforeEach 呼叫 `resetOidcStub()` 回到預設成功情境，再視案例覆寫
// `oidcStub.authorizationCodeGrant.mockRejectedValueOnce(...)` 等。
import { randomBytes } from 'crypto';

/** 與真套件同名的例外類別（OauthClient 以 instanceof 判斷）。 */
export class ClientError extends Error {}
export class ResponseBodyError extends Error {
  constructor(
    readonly error: string,
    readonly error_description?: string,
  ) {
    super(error);
  }
}
export class AuthorizationResponseError extends Error {
  constructor(
    readonly error: string,
    readonly error_description?: string,
  ) {
    super(error);
  }
}

export const customFetch: unique symbol = Symbol('customFetch');
export const skipSubjectCheck: unique symbol = Symbol('skipSubjectCheck');
export const skipStateCheck: unique symbol = Symbol('skipStateCheck');

/** 替身用的 Configuration 標記物件。 */
export class Configuration {
  readonly stub = true;
}

/** 預設成功情境的合成身分（一望即知為假）。 */
export const DEFAULT_STUB_IDENTITY = {
  sub: 'synthetic-sub-0001',
  employeeNumber: 'SYN0001',
  name: '測試員一號',
  email: 'syn0001@example.com',
  refreshToken: 'synthetic-refresh-token',
};

export type StubIdentity = typeof DEFAULT_STUB_IDENTITY;

/** 讓 authorizationCodeGrant 回傳指定身分（refreshToken=null 模擬上游未簽發 RT）。 */
export function tokensOf(
  identity: Partial<StubIdentity> & { refreshToken?: string | null },
) {
  const merged = { ...DEFAULT_STUB_IDENTITY, ...identity };
  return {
    access_token: 'synthetic-access-token',
    token_type: 'bearer',
    id_token: 'synthetic-id-token',
    refresh_token: merged.refreshToken ?? undefined,
    claims: () => ({ sub: merged.sub }),
    expiresIn: () => 900,
  };
}

/** 讓 fetchUserInfo 回傳指定身分。 */
export function userInfoOf(identity: Partial<StubIdentity>) {
  const merged = { ...DEFAULT_STUB_IDENTITY, ...identity };
  return {
    sub: merged.sub,
    employee_number: merged.employeeNumber,
    name: merged.name,
    email: merged.email,
    email_verified: false,
  };
}

const random = () => randomBytes(32).toString('base64url');

export const randomState = jest.fn(random);
export const randomNonce = jest.fn(random);
export const ClientSecretPost = jest.fn((secret?: string) => ({ secret }));
export const enableNonRepudiationChecks = jest.fn();
export const allowInsecureRequests = jest.fn();
export const discovery = jest.fn();
export const buildAuthorizationUrl = jest.fn();
export const authorizationCodeGrant = jest.fn();
export const fetchUserInfo = jest.fn();

/** 回到預設成功情境；每個測試案例開始前呼叫。 */
export function resetOidcStub(): void {
  for (const fn of [
    discovery,
    buildAuthorizationUrl,
    authorizationCodeGrant,
    fetchUserInfo,
    enableNonRepudiationChecks,
    allowInsecureRequests,
    ClientSecretPost,
  ]) {
    fn.mockReset();
  }
  discovery.mockResolvedValue(new Configuration());
  buildAuthorizationUrl.mockImplementation(
    (_config: unknown, params: Record<string, string>) =>
      new URL(
        `https://auth.example.com/authorize?${new URLSearchParams(params)}`,
      ),
  );
  authorizationCodeGrant.mockResolvedValue(tokensOf({}));
  fetchUserInfo.mockResolvedValue(userInfoOf({}));
}

resetOidcStub();
