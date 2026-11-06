import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EsignExportService } from './esign-export.service';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { PRIVATE_FILE_STORAGE } from '#app/infrastructure/file-storage/private-file-storage.port';
import { ExportJobRepository } from '../repositories/export-job.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { EsignExportJob } from '../entities/esign-export-job.entity';
import { EsignSignatureRecord } from '../entities/esign-signature-record.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { ESIGN_EXPORT_QUEUE } from '../esign-queue.constants';

describe('ZIP 按需更新公開服務', () => {
  let service: EsignExportService;
  let current: EsignExportJob | null;
  let work: EsignExportJob | null;
  let records: EsignSignatureRecord[];
  let saved: EsignExportJob[];
  const stat = jest.fn(async () => ({ fileSize: 10 }));
  const manager = {};
  const record = (id: number) =>
    Object.assign(new EsignSignatureRecord(), {
      id,
      signer: Object.assign(new EsignSigner(), {
        publicId: `signer-${id}`,
        nameSnapshot: `測試${id}`,
      }),
    });
  beforeEach(async () => {
    current = Object.assign(new EsignExportJob(), {
      id: 1,
      publicId: 'first',
      documentId: 9,
      status: 'completed',
      completedAt: new Date(),
      snapshotJson: [
        { recordId: 1, signerPublicId: 'signer-1', fileName: 'one.pdf' },
      ],
      recordCount: 1,
    });
    work = null;
    records = [record(1), record(2)];
    saved = [];
    stat.mockClear();
    const module = await Test.createTestingModule({
      providers: [
        EsignExportService,
        {
          provide: MysqlService,
          useValue: {
            getManager: () => manager,
            transaction: <T>(fn: (m: object) => Promise<T>) => fn(manager),
          },
        },
        {
          provide: DocumentRepository,
          useValue: {
            findByIdForUpdate: async () => ({ id: 9 }),
            findById: async () => ({ id: 9 }),
          },
        },
        {
          provide: EsignAccessPolicyService,
          useValue: { checkDepartmentDocument: async () => ({ id: 9 }) },
        },
        {
          provide: ExportJobRepository,
          useValue: {
            reusable: async () => work ?? current,
            current: async () => current,
            work: async () => work,
            records: async () => records,
            recordIds: async () => records.map((r) => r.id),
            snapshotRecordIds: async (id: number) =>
              (id === current?.id ? current : work)?.snapshotJson?.map(
                (entry) => entry.recordId,
              ) ?? [],
            files: async (id: number) =>
              id === 1
                ? [{ id: 1, fileSize: 10, archiveStatus: 'active' }]
                : [],
            create: (fields: Partial<EsignExportJob>) =>
              Object.assign(new EsignExportJob(), fields),
            save: async (job: EsignExportJob) => {
              job.id = 2;
              saved.push(job);
              return job;
            },
          },
        },
        {
          provide: FileObjectRepository,
          useValue: { findCompletedFiles: async () => [] },
        },
        { provide: PRIVATE_FILE_STORAGE, useValue: { stat } },
        {
          provide: getQueueToken(ESIGN_EXPORT_QUEUE),
          useValue: { add: async () => undefined },
        },
      ],
    }).compile();
    service = module.get(EsignExportService);
  });

  it('已有一份成果，新增簽署後明確申請取得兩份的新工作', async () => {
    const result = await service.request(9, 7);
    expect(result).toMatchObject({
      status: 'pending',
      expectedCount: 2,
      reused: false,
    });
    expect(saved[0].snapshotJson?.map((entry) => entry.recordId)).toEqual([
      1, 2,
    ]);
  });
  it('摘要分開目前版及更新工作，讀取不建立工作或洩漏快照', async () => {
    work = Object.assign(new EsignExportJob(), {
      id: 2,
      publicId: 'second',
      documentId: 9,
      status: 'pending',
      snapshotJson: [{ recordId: 1 }, { recordId: 2 }],
      recordCount: 2,
    });
    const state = await service.documentState(9, 7);
    expect(state).toMatchObject({
      current: { id: 'first', expectedCount: 1 },
      work: { id: 'second', expectedCount: 2 },
      currentNewSignatureCount: 1,
      workNewSignatureCount: 0,
    });
    expect(JSON.stringify(state)).not.toContain('snapshotJson');
    expect(saved).toHaveLength(0);
  });

  it('相同份數但不同簽署紀錄仍需更新', async () => {
    records = [record(2)];
    expect(await service.request(9, 7)).toMatchObject({
      expectedCount: 1,
      reused: false,
    });
    expect(saved[0].snapshotJson?.[0].recordId).toBe(2);
  });

  it('名稱與個人 PDF 就緒狀態不改變已包含的紀錄', async () => {
    records = [record(1)];
    records[0].signer!.nameSnapshot = '改名';
    expect(await service.request(9, 7)).toMatchObject({
      id: 'first',
      reused: true,
    });
    expect(saved).toHaveLength(0);
  });

  it('新增簽署但有進行中工作時沿用該工作', async () => {
    work = Object.assign(new EsignExportJob(), {
      id: 2,
      publicId: 'working',
      documentId: 9,
      status: 'processing',
      recordCount: 1,
    });
    expect(await service.request(9, 7)).toMatchObject({
      id: 'working',
      reused: true,
      expectedCount: 1,
    });
    expect(saved).toHaveLength(0);
  });

  it('最新失敗工作回傳待重試，不建立替代快照', async () => {
    work = Object.assign(new EsignExportJob(), {
      id: 2,
      publicId: 'failed',
      documentId: 9,
      status: 'failed',
      recordCount: 2,
    });
    expect(await service.request(9, 7)).toMatchObject({
      id: 'failed',
      status: 'failed',
      reused: true,
    });
    expect(saved).toHaveLength(0);
  });

  it('舊成果缺檔但有新簽署時仍可明確更新', async () => {
    stat.mockRejectedValueOnce(new Error('缺檔'));
    expect(await service.request(9, 7)).toMatchObject({
      reused: false,
      expectedCount: 2,
    });
    expect(stat).not.toHaveBeenCalled();
    stat.mockReset().mockResolvedValue({ fileSize: 10 });
  });

  it('沒有新簽署時缺檔必須報錯，不另建工作', async () => {
    records = [record(1)];
    stat.mockRejectedValueOnce(new Error('缺檔'));
    await expect(service.request(9, 7)).rejects.toMatchObject({
      code: 'ESIGN_EXPORT_UNAVAILABLE',
    });
    expect(saved).toHaveLength(0);
  });

  it('無既有成果且無簽署時不產生空 ZIP', async () => {
    current = null;
    records = [];
    await expect(service.request(9, 7)).rejects.toMatchObject({
      code: 'ESIGN_EXPORT_EMPTY',
    });
    expect(saved).toHaveLength(0);
  });
});
