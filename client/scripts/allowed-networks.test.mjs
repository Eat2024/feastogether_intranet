// 隱藏維護入口的來源網路判斷（src/lib/allowedNetworks.ts，proxy 與啟動檢查共用）。
// Node 內建 test runner 直接載入 .ts（型別剝除），不需要額外套件。位址一律用 RFC 5737／3849 文件用位址。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedClient, parseAllowedNetworks } from '../src/lib/allowedNetworks.ts';

const list = parseAllowedNetworks('203.0.113.0/24, 198.51.100.7/32,2001:db8:1::/48');
const allowed = (headers, networks = list) => isAllowedClient(networks, new Headers(headers));

test('X-Real-IP 在清單內才允許（IPv4 網段、單一位址、IPv6）', () => {
  assert.equal(allowed({ 'x-real-ip': '203.0.113.10' }), true);
  assert.equal(allowed({ 'x-real-ip': '198.51.100.7' }), true);
  assert.equal(allowed({ 'x-real-ip': '2001:db8:1::1' }), true);
  assert.equal(allowed({ 'x-real-ip': '198.51.100.8' }), false);
  assert.equal(allowed({ 'x-real-ip': '192.0.2.1' }), false);
  assert.equal(allowed({ 'x-real-ip': '2001:db8:2::1' }), false);
});

test('缺 X-Real-IP、空值或不是 IP 時不允許', () => {
  assert.equal(allowed({}), false);
  assert.equal(allowed({ 'x-real-ip': '' }), false);
  assert.equal(allowed({ 'x-real-ip': 'unknown' }), false);
  assert.equal(allowed({ 'x-real-ip': '203.0.113.10, 192.0.2.1' }), false);
});

test('只看 X-Real-IP：偽造 X-Forwarded-For 不影響結果', () => {
  assert.equal(allowed({ 'x-forwarded-for': '203.0.113.10' }), false);
  assert.equal(allowed({ 'x-forwarded-for': '203.0.113.10', 'x-real-ip': '192.0.2.1' }), false);
  assert.equal(allowed({ 'x-forwarded-for': '192.0.2.1', 'x-real-ip': '203.0.113.10' }), true);
});

test('未設定或空字串：維護登入停用，一律不允許', () => {
  for (const value of [undefined, '', '  ']) {
    assert.equal(allowed({ 'x-real-ip': '203.0.113.10' }, parseAllowedNetworks(value)), false);
  }
});

test('任一項不是合法 CIDR 時丟錯，訊息只帶變數名、不帶值', () => {
  for (const value of [
    '203.0.113.0',
    '203.0.113.0/33',
    '2001:db8::/129',
    'example.com/24',
    '203.0.113.0/24/1',
    '203.0.113.0/x',
    '203.0.113.0/24,',
    '203.0.113.0/24,198.51.100.7',
  ]) {
    assert.throws(
      () => parseAllowedNetworks(value),
      (error) => error.message.includes('SUPER_USER_ALLOWED_CIDRS') && !error.message.includes('203.0.113'),
      value,
    );
  }
});
