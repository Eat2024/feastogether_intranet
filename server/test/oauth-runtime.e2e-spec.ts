import { execFileSync } from 'child_process';

/**
 * 038 T002：真 openid-client 套件載入 smoke。
 *
 * Jest 內的 `openid-client` 一律走 moduleNameMapper 替身（ESM-only 套件無法進 Jest CJS
 * 模組系統），因此這裡改以獨立 Node 子程序執行 `require('openid-client')`，驗證目前
 * runtime（本機、CI、Docker image 皆 ≥20.19）確實支援 require(esm) 並能取得必要 API。
 * 這是 dist／runtime 相容性的證據，不是協定驗簽測試。
 */
describe('openid-client runtime smoke (038)', () => {
  it('目前 Node 可以 require(esm) 載入 openid-client 並取得必要函式', () => {
    const script = `
      const oidc = require('openid-client');
      const required = ['discovery','ClientSecretPost','buildAuthorizationUrl',
        'authorizationCodeGrant','fetchUserInfo','enableNonRepudiationChecks',
        'allowInsecureRequests','randomState','randomNonce'];
      const missing = required.filter((name) => typeof oidc[name] !== 'function');
      if (missing.length) { console.error('missing: ' + missing.join(',')); process.exit(2); }
      console.log('ok');
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(output.trim()).toBe('ok');
  });

  it('Node 版本符合 require(esm) 基線（≥20.19.0）', () => {
    const [major, minor] = process.versions.node.split('.').map(Number);
    expect(major > 20 || (major === 20 && minor >= 19)).toBe(true);
  });
});
