import type { Job } from 'bullmq';
import { EsignMaintenanceProcessor } from './esign-maintenance.processor';
import { EsignMaintenanceScheduler } from './esign-maintenance.scheduler';
import {
  ESIGN_DOCUMENT_FINALIZATION_JOB,
  ESIGN_EXTERNAL_INVITATION_JOB,
  ESIGN_MAINTENANCE_JOB,
} from '#app/features/esign/esign-queue.constants';

describe('Esign maintenance', () => {
  it('scheduler 固定每 30 秒註冊一個喚醒工作', async () => {
    const queue = { upsertJobScheduler: jest.fn() };
    await new EsignMaintenanceScheduler(queue as never).onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'esign-maintenance:30s',
      { every: 30_000 },
      { name: ESIGN_MAINTENANCE_JOB, data: {} },
    );
  });

  it('每次喚醒先收斂期限，再只以 local ID 補入 invitation/finalization', async () => {
    const manager = {} as never;
    const expiry = { reconcile: jest.fn(async () => 1) };
    const notifications = {
      findEligibleInvitationLogIds: jest.fn(
        async (_now, _stale, _manager, afterId) =>
          afterId === 0 ? [{ id: '11' }] : [],
      ),
    };
    const documents = {
      findFinalizationCandidates: jest.fn(async (afterId) =>
        afterId === 0 ? [{ id: '22' }] : [],
      ),
    };
    const invitationQueue = { add: jest.fn() };
    const finalizationQueue = { add: jest.fn() };
    const candidates = Array.from({ length: 205 }, (_, i) => ({
      id: String(i + 1),
      documentId: '22',
    }));
    const finalization = { finalizeDocument: jest.fn() };
    const signers = {
      findCompletionCandidates: jest.fn(async (_now, afterId) =>
        candidates.filter((row) => Number(row.id) > afterId).slice(0, 100),
      ),
    };
    const processor = new EsignMaintenanceProcessor(
      { getManager: () => manager } as never,
      notifications as never,
      documents as never,
      expiry as never,
      invitationQueue as never,
      finalizationQueue as never,
      signers as never,
      finalization as never,
    );

    await processor.process({ data: {} } as Job);

    expect(expiry.reconcile).toHaveBeenCalledWith(expect.any(Date));
    expect(invitationQueue.add).toHaveBeenCalledWith(
      ESIGN_EXTERNAL_INVITATION_JOB,
      { notificationLogId: 11 },
      expect.objectContaining({ attempts: 1 }),
    );
    expect(finalizationQueue.add).toHaveBeenCalledWith(
      ESIGN_DOCUMENT_FINALIZATION_JOB,
      { documentId: 22, signerId: 205 },
      expect.objectContaining({ attempts: 1 }),
    );
    expect(finalizationQueue.add).toHaveBeenCalledTimes(205);
    expect(finalization.finalizeDocument).toHaveBeenCalledWith(22);
    expect(JSON.stringify(invitationQueue.add.mock.calls)).not.toMatch(
      /email|token|ciphertext|png|pdf/i,
    );
  });

  it('Redis enqueue 失敗向外拋出，讓 BullMQ 重試而不偽裝完成', async () => {
    const processor = new EsignMaintenanceProcessor(
      { getManager: () => ({}) } as never,
      {
        findEligibleInvitationLogIds: jest.fn(async () => [{ id: '11' }]),
      } as never,
      { findFinalizationCandidates: jest.fn(async () => []) } as never,
      { reconcile: jest.fn(async () => 0) } as never,
      {
        add: jest.fn(async () => {
          throw new Error('redis down');
        }),
      } as never,
      { add: jest.fn() } as never,
      {} as never,
      {} as never,
    );
    await expect(processor.process({ data: {} } as Job)).rejects.toThrow(
      'redis down',
    );
  });
});
