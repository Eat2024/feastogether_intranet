import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getEmptyNavigationPresentation,
  getIdentityBoundaryPhase,
  keepsBusinessSubtreeMounted,
} from '../src/features/navigation/identity-adoption.ts';
import {
  isAuthorizationQueryKey,
  isInternalBusinessQueryKey,
  isInternalIdentityQueryKey,
  shouldRevalidateAuthorization,
  SingleFlight,
} from '../src/features/navigation/authorization-cache-policy.ts';

const phase = (overrides = {}) => getIdentityBoundaryPhase({
  queryStatus: 'success',
  fetchStatus: 'idle',
  hasData: true,
  adoptedIdentity: 'employee:1',
  incomingIdentity: 'employee:1',
  ...overrides,
});

test('同 actor focus refetch 保留掛載但阻擋呈現，actor A→B 才卸載採用', () => {
  const revalidating = phase({ fetchStatus: 'fetching' });
  assert.equal(revalidating, 'revalidating');
  assert.equal(keepsBusinessSubtreeMounted(revalidating), true);
  assert.equal(phase({ incomingIdentity: 'employee:2' }), 'adopting');
  assert.equal(keepsBusinessSubtreeMounted('adopting'), false);
  assert.equal(phase(), 'ready');
  assert.equal(keepsBusinessSubtreeMounted('ready'), true);
});

test('同 actor paused/error 保留掛載並遮蔽，初次失敗不掛載', () => {
  assert.equal(phase({ fetchStatus: 'paused' }), 'revalidation-paused');
  assert.equal(keepsBusinessSubtreeMounted('revalidation-paused'), true);
  assert.equal(phase({ queryStatus: 'error' }), 'revalidation-error');
  assert.equal(keepsBusinessSubtreeMounted('revalidation-error'), true);
  assert.equal(phase({
    queryStatus: 'error', hasData: false, incomingIdentity: null, adoptedIdentity: null,
  }), 'initial-error');
  assert.equal(keepsBusinessSubtreeMounted('initial-error'), false);
});

test('無可用功能在展開與收合側欄都有可理解狀態', () => {
  assert.equal(getEmptyNavigationPresentation('empty', true), 'expanded-message');
  assert.equal(getEmptyNavigationPresentation('empty', false), 'compact-tooltip');
  assert.equal(getEmptyNavigationPresentation('ready', false), 'none');
});

test('401 清理範圍包含 AUTH_ME 與內部 ESIGN，但不含外部／公開 query', () => {
  assert.equal(isAuthorizationQueryKey(['AUTH_ME', '/esign/forms']), true);
  assert.equal(isInternalBusinessQueryKey(['ESIGN_DOCUMENTS']), true);
  assert.equal(isInternalIdentityQueryKey(['AUTH_ME']), true);
  assert.equal(isInternalIdentityQueryKey(['EXTERNAL_SIGNING_TASK']), false);
  assert.equal(isInternalIdentityQueryKey(['SIGNATURE_VERIFICATION']), false);
});

test('只有內部業務 AUTHORIZATION_DENIED 觸發重驗，能力 query 不形成循環', () => {
  assert.equal(shouldRevalidateAuthorization({
    status: 403, code: 'AUTHORIZATION_DENIED', url: 'esign/documents',
  }), true);
  assert.equal(shouldRevalidateAuthorization({
    status: 403, code: 'AUTHORIZATION_DENIED', url: 'auth/me', failedQueryKey: ['AUTH_ME'],
  }), false);
  assert.equal(shouldRevalidateAuthorization({
    status: 403, code: 'CSRF_INVALID', url: 'esign/documents',
  }), false);
  assert.equal(shouldRevalidateAuthorization({
    status: 403, code: 'AUTHORIZATION_DENIED', url: 'external-signing-task',
  }), false);
});

test('同時發生的 403 只執行一輪重驗，完成後可再次執行', async () => {
  const flight = new SingleFlight();
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const task = async () => { runs += 1; await gate; };
  const first = flight.run(task);
  const second = flight.run(task);
  assert.equal(first, second);
  assert.equal(runs, 1);
  release();
  await first;
  await flight.run(async () => { runs += 1; });
  assert.equal(runs, 2);
});
