import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { EntityManager } from 'typeorm';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignExportJob } from '#app/features/esign/entities/esign-export-job.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import { ExternalAccessCredentialService } from '#app/features/esign/services/external-access-credential.service';
import { EXTERNAL_ACCESS_COOKIE } from '#app/features/esign/helpers/external-signature-cookie';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { apiData, apiError } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

jest.setTimeout(30_000);

const historyPath = '/api/esign/history/export';
const types = ['excel', 'pdf', 'zip'] as const;
type HistoryType = (typeof types)[number];
type TypeTotals = Record<HistoryType, number>;

interface HistoryItem {
  id: string;
  type: HistoryType;
  document: { id: string; title: string; docNumber: string };
  exportedBy: {
    name: string;
    employeeNo: string | null;
    email: string | null;
  };
  exportedAt: string;
  scope: string;
  count: number;
  [field: string]: unknown;
}

interface HistoryPage {
  items: HistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  typeTotals: TypeTotals;
}

describe('Spec015 歷史匯出紀錄 API', () => {
  let ctx: SecurityE2eContext;
  let manager: EntityManager;
  let creator: User;
  let exporter: User;
  let internalUser: User;
  /** 非建立人、非匯出人的員工，用來確認所有員工都看得到全部紀錄。 */
  let viewerCookie: string;
  let externalCookie: string;
  let docA: EsignDocument;
  let docB: EsignDocument;
  let internalSigner: EsignSigner;
  let externalSigner: EsignSigner;

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    manager = ctx.app.get(MysqlService).getManager();
    const prefix = randomBytes(4).toString('hex');
    const [creatorUser, exporterUser, internal, viewer] = await manager.save(
      User,
      ['建立人', '匯出員工', '內部簽署人', '查閱員工'].map((name, index) =>
        manager.create(User, {
          empid: `H${prefix}${index}`,
          name: `合成${name}`,
          isActive: true,
        }),
      ),
    );
    creator = creatorUser;
    exporter = exporterUser;
    internalUser = internal;
    viewerCookie = await employeeCookie(viewer);
    docA = await createDocument('合成歷史文件 A');
    docB = await createDocument('合成歷史文件 B');
    internalSigner = await createSigner({
      signerType: 'user',
      userId: internalUser.id,
      empidSnapshot: internalUser.empid,
      // 與員工目前姓名不同：匯出人應取自員工資料，不是簽署人快照。
      nameSnapshot: `${internalUser.name}（發起時）`,
    });
    externalSigner = await createSigner({
      signerType: 'email',
      email: `lin-${prefix}@example.test`,
      nameSnapshot: '林外部',
    });
    const credential = await ctx.app
      .get(ExternalAccessCredentialService)
      .issue(externalSigner.id, 'a'.repeat(64));
    externalCookie = `${EXTERNAL_ACCESS_COOKIE}=${credential}`;
  });

  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  async function employeeCookie(user: User) {
    const session = await ctx.app.get(AuthService).issueSession(user.id);
    return `${AUTH_COOKIE_NAME}=${session.token}`;
  }

  function createDocument(title: string) {
    return manager.save(
      EsignDocument,
      manager.create(EsignDocument, {
        docNumber: randomUUID(),
        title,
        status: 'active',
        createdByUserId: creator.id,
        signStartAt: new Date(Date.now() - 86_400_000),
        signEndAt: new Date(Date.now() + 86_400_000),
      }),
    );
  }

  function createSigner(fields: Partial<EsignSigner>) {
    return manager.save(
      EsignSigner,
      manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: docA.id,
        status: 'pending',
        sortOrder: 0,
        ...fields,
      }),
    );
  }

  /** 直接寫入合成紀錄（Excel／PDF 的寫入 API 在後續票單）；created_at 以 SQL 固定，供排序驗證。 */
  async function insertRecord(
    fields: Partial<EsignExportJob>,
    createdAt: Date,
  ) {
    const job = await manager.save(
      EsignExportJob,
      manager.create(EsignExportJob, {
        publicId: randomUUID(),
        status: 'completed',
        completedAt: createdAt,
        ...fields,
      }),
    );
    await manager.query(
      'UPDATE esign_export_jobs SET created_at = ? WHERE id = ?',
      [createdAt, job.id],
    );
    return Object.assign(job, { createdAt });
  }

  async function history(query: string): Promise<HistoryPage> {
    return apiData<HistoryPage>(
      await request(ctx.server)
        .get(`${historyPath}?${query}`)
        .set('Cookie', viewerCookie)
        .expect(200),
    );
  }

  function documentView(document: EsignDocument) {
    return {
      id: String(document.id),
      title: document.title,
      docNumber: document.docNumber,
    };
  }

  describe('查詢紀錄', () => {
    const conditions = {
      statuses: ['signed'],
      depts: [],
      fields: ['name', 'employeeNo', 'dept', 'status', 'signedAt'],
    };
    let baseline: TypeTotals;
    let excelA: EsignExportJob[];
    let pdfByCreator: EsignExportJob;
    let pdfByInternalSigner: EsignExportJob;
    let pdfByExternalSigner: EsignExportJob;
    let zipA: EsignExportJob;
    let zipFileA: EsignFileObject;
    let legacyZipA: EsignExportJob;

    beforeAll(async () => {
      baseline = (await history('type=excel')).typeTotals;
      const base = Date.now() - 3_600_000;
      const at = (seconds: number) => new Date(base + seconds * 1000);
      const excel = (document: EsignDocument, index: number, seconds: number) =>
        insertRecord(
          {
            exportType: 'excel',
            documentId: document.id,
            createdByUserId: exporter.id,
            scopeDescription: `狀態：已簽署；第 ${index} 筆`,
            recordCount: index,
            conditionsJson: conditions,
          },
          at(seconds),
        );
      // 越晚寫入（流水號越大）的紀錄匯出時間越早，且每兩筆同一時間：同時驗證時間優先與流水號次序。
      excelA = [];
      for (let index = 0; index < 23; index++)
        excelA.push(await excel(docA, index, (22 - index) >> 1));
      await excel(docB, 100, 20);
      await excel(docB, 101, 21);
      const pdf = (
        createdByUserId: number | null,
        signer: EsignSigner,
        scope: string,
        seconds: number,
      ) =>
        insertRecord(
          {
            exportType: 'pdf',
            documentId: docA.id,
            createdByUserId,
            signerId: signer.id,
            scopeDescription: scope,
            recordCount: 1,
          },
          at(seconds),
        );
      const externalLabel = `林外部（${externalSigner.email}）`;
      pdfByCreator = await pdf(creator.id, externalSigner, externalLabel, 30);
      pdfByInternalSigner = await pdf(
        internalUser.id,
        internalSigner,
        `${internalUser.name}（${internalUser.empid}）`,
        31,
      );
      pdfByExternalSigner = await pdf(null, externalSigner, externalLabel, 32);
      const zip = (
        document: EsignDocument,
        fields: Partial<EsignExportJob>,
        seconds: number,
      ) =>
        insertRecord(
          {
            exportType: 'signed_copies_zip',
            documentId: document.id,
            createdByUserId: creator.id,
            scopeDescription: '此次簽署的所有已簽副本',
            recordCount: 6,
            ...fields,
          },
          at(seconds),
        );
      zipA = await zip(
        docA,
        {
          snapshotAt: at(40),
          snapshotJson: [],
          snapshotSha256: 'c'.repeat(64),
          processedCount: 6,
          waitingCount: 0,
          attemptCount: 1,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        40,
      );
      zipFileA = await manager.save(
        EsignFileObject,
        manager.create(EsignFileObject, {
          exportJobId: zipA.id,
          filePurpose: 'signed_copies_zip',
          objectKey: `exports/history-${zipA.publicId}.zip`,
          originalFileName: '合成副本.zip',
          mimeType: 'application/zip',
          fileSize: 123456,
          sha256: 'd'.repeat(64),
          archiveStatus: 'active',
        }),
      );
      // 沒有快照的舊 ZIP 列不是匯出工作，查詢與計數都要排除。
      legacyZipA = await zip(docA, {}, 41);
      await zip(
        docB,
        {
          status: 'pending',
          completedAt: undefined,
          snapshotAt: at(42),
          snapshotJson: [],
          snapshotSha256: 'e'.repeat(64),
          processedCount: 0,
          waitingCount: 6,
          attemptCount: 0,
        },
        42,
      );
    });

    it.each([
      ['缺 type', ''],
      ['未知 type', 'type=sheet'],
      ['page=0', 'type=excel&page=0'],
      ['pageSize=101', 'type=excel&pageSize=101'],
      ['pageSize=0', 'type=excel&pageSize=0'],
      ['documentId 非數字', 'type=excel&documentId=abc'],
      ['documentId=0', 'type=excel&documentId=0'],
      ['未知參數', 'type=excel&limit=1'],
    ])('%s 回 400 INVALID_REQUEST', async (_name, query) => {
      const response = await request(ctx.server)
        .get(`${historyPath}?${query}`)
        .set('Cookie', viewerCookie)
        .expect(400);
      expect(apiError(response).code).toBe('INVALID_REQUEST');
    });

    it('未登入與外部存取 cookie 回 401', async () => {
      await request(ctx.server).get(`${historyPath}?type=excel`).expect(401);
      const response = await request(ctx.server)
        .get(`${historyPath}?type=pdf`)
        .set('Cookie', externalCookie)
        .expect(401);
      expect(apiError(response).code).toBe('UNAUTHORIZED');
    });

    it('依匯出時間、流水號由新到舊以頁碼翻頁，不漏不重', async () => {
      const query = `type=excel&documentId=${docA.id}&pageSize=10`;
      const pages = [
        await history(`${query}&page=1`),
        await history(`${query}&page=2`),
        await history(`${query}&page=3`),
        await history(`${query}&page=4`),
      ];
      expect(pages.map((page) => page.items.length)).toEqual([10, 10, 3, 0]);
      expect(pages.map((page) => page.page)).toEqual([1, 2, 3, 4]);
      for (const page of pages) {
        expect(page.total).toBe(23);
        expect(page.pageSize).toBe(10);
      }
      const expectedOrder = [
        0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20,
        19, 22, 21,
      ];
      expect(
        pages.flatMap((page) => page.items.map((item) => item.id)),
      ).toEqual(expectedOrder.map((index) => excelA[index].publicId));
    });

    it('typeTotals 帶與不帶 documentId 都正確，並與逐頁合計一致', async () => {
      const docATotals = { excel: 23, pdf: 3, zip: 1 };
      for (const type of types) {
        const page = await history(`type=${type}&documentId=${docA.id}`);
        expect(page.typeTotals).toEqual(docATotals);
        expect(page.total).toBe(docATotals[type]);
        let listed = page.items.length;
        for (let next = 2; listed < page.total && next < 10; next++)
          listed += (
            await history(`type=${type}&documentId=${docA.id}&page=${next}`)
          ).items.length;
        expect(listed).toBe(docATotals[type]);
      }
      const docBPage = await history(`type=pdf&documentId=${docB.id}`);
      expect(docBPage).toMatchObject({
        items: [],
        total: 0,
        typeTotals: { excel: 2, pdf: 0, zip: 1 },
      });
      const all = await history('type=zip');
      expect(all.typeTotals).toEqual({
        excel: baseline.excel + 25,
        pdf: baseline.pdf + 3,
        zip: baseline.zip + 2,
      });
      expect(all.total).toBe(all.typeTotals.zip);
      expect(all).toMatchObject({ page: 1, pageSize: 10 });
    });

    it('非建立人、非匯出人也看得到 excel 紀錄與匯出條件', async () => {
      const [latest] = (await history(`type=excel&documentId=${docA.id}`))
        .items;
      expect(latest).toEqual({
        id: excelA[0].publicId,
        type: 'excel',
        document: documentView(docA),
        exportedBy: {
          name: exporter.name,
          employeeNo: exporter.empid,
          email: null,
        },
        exportedAt: excelA[0].createdAt.toISOString(),
        scope: '狀態：已簽署；第 0 筆',
        count: 0,
        conditions,
      });
    });

    it('pdf 的匯出人區分員工、本人下載的內部簽署人與外部簽署人', async () => {
      const page = await history(`type=pdf&documentId=${docA.id}`);
      const pdfItem = (
        job: EsignExportJob,
        signer: EsignSigner,
        exportedBy: HistoryItem['exportedBy'],
      ) => ({
        id: job.publicId,
        type: 'pdf',
        document: documentView(docA),
        exportedBy,
        exportedAt: job.createdAt.toISOString(),
        scope: job.scopeDescription,
        count: 1,
        signerPublicId: signer.publicId,
      });
      expect(page.items).toEqual([
        pdfItem(pdfByExternalSigner, externalSigner, {
          name: '林外部',
          employeeNo: null,
          email: externalSigner.email!,
        }),
        pdfItem(pdfByInternalSigner, internalSigner, {
          name: internalUser.name,
          employeeNo: internalUser.empid,
          email: null,
        }),
        pdfItem(pdfByCreator, externalSigner, {
          name: creator.name,
          employeeNo: creator.empid,
          email: null,
        }),
      ]);
    });

    it('zip 只列有快照的匯出工作，沿用既有工作欄位且不含 requesterName', async () => {
      const page = await history(`type=zip&documentId=${docA.id}&pageSize=1`);
      expect(page.items.map((item) => item.id)).not.toContain(
        legacyZipA.publicId,
      );
      expect(page.items).toEqual([
        {
          id: zipA.publicId,
          type: 'zip',
          document: documentView(docA),
          exportedBy: {
            name: creator.name,
            employeeNo: creator.empid,
            email: null,
          },
          exportedAt: zipA.createdAt.toISOString(),
          scope: '此次簽署的所有已簽副本',
          count: 6,
          documentId: String(docA.id),
          status: 'completed',
          snapshotAt: zipA.snapshotAt!.toISOString(),
          expectedCount: 6,
          processedCount: 6,
          waitingCount: 0,
          completedAt: zipA.completedAt!.toISOString(),
          expiresAt: zipA.expiresAt!.toISOString(),
          failureCode: null,
          files: [
            {
              id: String(zipFileA.id),
              fileName: '合成副本.zip',
              size: 123456,
              sha256: 'd'.repeat(64),
              downloadPath: `/api/esign/documents/${docA.id}/exports/${zipA.publicId}/files/${zipFileA.id}`,
            },
          ],
        },
      ]);
      expect(page.items[0]).not.toHaveProperty('requesterName');
    });
  });
});
