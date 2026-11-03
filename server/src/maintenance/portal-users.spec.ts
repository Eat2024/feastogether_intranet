import { parsePortalUsersArgs } from './portal-users.args';

describe('手動匯入 CLI 參數', () => {
  it.each([
    [['sync', '--dry-run'], { dryRun: true }],
    [['sync'], { dryRun: false }],
    [
      ['sync', '--allow-deactivations', '501'],
      { dryRun: false, confirmedDeactivations: 501 },
    ],
  ])('接受 %j', (args, expected) => {
    expect(parsePortalUsersArgs(args)).toEqual(expected);
  });

  it.each([
    [[]],
    [['preview', '--input', 'portal.tsv']],
    [['apply', '--preview', 'preview.json']],
    [['rollback-preview', '--result', 'result.json']],
    [['rollback', '--preview', 'rollback.json']],
    [['sync', '--input', 'portal.tsv']],
    [['sync', '--output', 'result.json']],
    [['sync', '--exclude-file', 'exclusions.json']],
    [['sync', '--acquired-at', '2026-11-03T00:00:00Z']],
    [['sync', '--dry-run', '--allow-deactivations', '501']],
    [['sync', '--allow-deactivations']],
    [['sync', '--allow-deactivations', 'all']],
    [['sync', '--allow-deactivations', '-1']],
    [['sync', '--allow-deactivations', '1.5']],
    [['sync', '--dry-run', 'extra']],
  ])('拒絕 %j', (args) => {
    expect(parsePortalUsersArgs(args)).toBeUndefined();
  });
});
