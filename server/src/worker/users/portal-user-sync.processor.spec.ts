import { PortalUserSyncError } from '#app/features/users/services/portal-user-sync.service';
import { PortalUserSyncProcessor } from './portal-user-sync.processor';

describe('PortalUserSyncProcessor', () => {
  it('以排程身分正式執行匯入', async () => {
    const sync = { run: jest.fn().mockResolvedValue({ summary: {} }) };
    await new PortalUserSyncProcessor(sync as never).process();
    expect(sync.run).toHaveBeenCalledWith({
      trigger: 'schedule',
      dryRun: false,
    });
  });

  it('匯入失敗時原樣拋出，讓 job 標成失敗', async () => {
    const failure = new PortalUserSyncError('source', 'ECONNREFUSED');
    const sync = { run: jest.fn().mockRejectedValue(failure) };
    await expect(
      new PortalUserSyncProcessor(sync as never).process(),
    ).rejects.toBe(failure);
  });
});
