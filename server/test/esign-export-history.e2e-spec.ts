import { randomBytes, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import type { EntityManager } from 'typeorm';
import { WorkerModule } from '#app/worker.module';
import { DocumentExportProcessor } from '#app/worker/esign/document-export.processor';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignExportJob } from '#app/features/esign/entities/esign-export-job.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import { EsignSignatureRecord } from '#app/features/esign/entities/esign-signature-record.entity';
import { ExportJobRepository } from '#app/features/esign/repositories/export-job.repository';
import { canonicalSha256 } from '#app/features/esign/services/esign-audit.service';
import { ExternalAccessCredentialService } from '#app/features/esign/services/external-access-credential.service';
import { EXTERNAL_ACCESS_COOKIE } from '#app/features/esign/helpers/external-signature-cookie';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
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

  /** 可產生已簽副本的文件：簽署 payload 與證據摘要一致。 */
  function createSignableDocument(title: string) {
    const payload = { synthetic: title };
    return manager.save(
      EsignDocument,
      manager.create(EsignDocument, {
        docNumber: randomUUID(),
        title,
        status: 'active',
        createdByUserId: creator.id,
        signStartAt: new Date(Date.now() - 86_400_000),
        signEndAt: new Date(Date.now() + 86_400_000),
        signingPayloadJson: payload,
        signingPayloadSha256: canonicalSha256(payload),
      }),
    );
  }

  interface SignedCopy {
    signer: EsignSigner;
    bytes: Buffer;
    objectKey: string;
  }

  /** 已簽且副本已產製的簽署人：證據與檔案摘要一致，走真實的副本讀取與完整性驗證。 */
  async function signedCopy(
    document: EsignDocument,
    fields: Partial<EsignSigner>,
  ): Promise<SignedCopy> {
    const signedAt = new Date();
    const signer = await manager.save(
      EsignSigner,
      manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: document.id,
        status: 'signed',
        signedAt,
        completionStatus: 'ready',
        completionReadyAt: signedAt,
        ...fields,
      }),
    );
    const record = await manager.save(
      EsignSignatureRecord,
      manager.create(EsignSignatureRecord, {
        signerId: signer.id,
        documentSha256: 'a'.repeat(64),
        signingPayloadSha256: document.signingPayloadSha256,
        consentVersion: 'test',
        authenticationMethod: 'test',
        authenticationEventId: randomUUID(),
        signedAtUtc: signedAt,
      }),
    );
    const pdf = await PDFDocument.create();
    pdf.setTitle(signer.publicId);
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    const stored = await ctx.app
      .get<PrivateFileStorage>(PRIVATE_FILE_STORAGE)
      .store({
        directory: `documents/history-pdf-${document.id}`,
        extension: 'pdf',
        mimeType: 'application/pdf',
        bytes,
      });
    await manager.save(
      EsignFileObject,
      manager.create(EsignFileObject, {
        ...stored,
        signatureRecordId: record.id,
        filePurpose: 'completed_pdf',
        archiveStatus: 'active',
      }),
    );
    return { signer, bytes, objectKey: stored.objectKey };
  }

  describe('單人 PDF 下載紀錄', () => {
    const origin = 'http://localhost:3000';
    let pdfDoc: EsignDocument;
    let internalCopy: SignedCopy;
    let externalCopy: SignedCopy;
    let pendingInternal: EsignSigner;
    let pendingExternal: EsignSigner;
    /** 重新下載用的既有紀錄：可下載的 pdf、副本未產生的 pdf，以及其他類型。 */
    let records: Record<'pdf' | 'pendingPdf' | 'excel' | 'zip', EsignExportJob>;
    let creatorCookie: string;

    beforeAll(async () => {
      creatorCookie = await employeeCookie(creator);
      pdfDoc = await createSignableDocument('合成下載文件');
      internalCopy = await signedCopy(pdfDoc, {
        signerType: 'user',
        userId: internalUser.id,
        empidSnapshot: internalUser.empid,
        nameSnapshot: '內部本人',
        sortOrder: 0,
      });
      externalCopy = await signedCopy(pdfDoc, {
        signerType: 'email',
        email: `copy-${randomBytes(4).toString('hex')}@example.test`,
        nameSnapshot: '外部本人',
        invitationTokenSha256: randomBytes(32).toString('hex'),
        sortOrder: 1,
      });
      const pending = (fields: Partial<EsignSigner>) =>
        manager.save(
          EsignSigner,
          manager.create(EsignSigner, {
            publicId: randomUUID(),
            documentId: pdfDoc.id,
            status: 'pending',
            ...fields,
          }),
        );
      pendingInternal = await pending({
        signerType: 'user',
        userId: exporter.id,
        empidSnapshot: exporter.empid,
        nameSnapshot: '待簽員工',
        sortOrder: 2,
      });
      pendingExternal = await pending({
        signerType: 'email',
        email: `pending-${randomBytes(4).toString('hex')}@example.test`,
        nameSnapshot: '待簽外部',
        invitationTokenSha256: randomBytes(32).toString('hex'),
        invitationExpiresAt: new Date(Date.now() + 86_400_000),
        sortOrder: 3,
      });
      const past = new Date(Date.now() - 3_600_000);
      const record = (fields: Partial<EsignExportJob>) =>
        insertRecord(
          {
            documentId: pdfDoc.id,
            createdByUserId: creator.id,
            scopeDescription: '合成紀錄',
            recordCount: 1,
            ...fields,
          },
          past,
        );
      records = {
        pdf: await record({
          exportType: 'pdf',
          signerId: internalCopy.signer.id,
        }),
        pendingPdf: await record({
          exportType: 'pdf',
          signerId: pendingInternal.id,
        }),
        excel: await record({
          exportType: 'excel',
          conditionsJson: { statuses: [], depts: [], fields: ['name'] },
        }),
        zip: await record({ exportType: 'signed_copies_zip' }),
      };
    });

    function creatorPath(signer: EsignSigner) {
      return `/api/esign/documents/${pdfDoc.id}/signers/${signer.publicId}/completed-file/downloads`;
    }

    function selfPath(signer: EsignSigner) {
      return `/api/esign/signing-tasks/${signer.publicId}/completed-file/downloads`;
    }

    const externalPath = '/api/external-signing-task/completed-file/downloads';

    function redownloadPath(recordId: string) {
      return `${historyPath}/${recordId}/downloads`;
    }

    /** 以外部簽署人目前的邀請世代核發存取 cookie（等同通過 Email OTP）。 */
    async function accessCookie(signer: EsignSigner) {
      const credential = await ctx.app
        .get(ExternalAccessCredentialService)
        .issue(signer.id, signer.invitationTokenSha256!);
      return `${EXTERNAL_ACCESS_COOKIE}=${credential}`;
    }

    function externalCopyCookie() {
      return accessCookie(externalCopy.signer);
    }

    function download(path: string, cookie?: string) {
      const pending = request(ctx.server).post(path).set('Origin', origin);
      return cookie ? pending.set('Cookie', cookie) : pending;
    }

    function pdfHistory() {
      return history(`type=pdf&documentId=${pdfDoc.id}`);
    }

    /** 與原本 GET 下載相同：附件檔名、不快取、nosniff，內容為已存的副本。 */
    function expectCompletedPdf(response: request.Response, copy: SignedCopy) {
      const fileName = `${pdfDoc.docNumber}_${pdfDoc.title}_${copy.signer.nameSnapshot}.pdf`;
      expect(response.headers['content-type']).toMatch(/^application\/pdf/);
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="completed.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(response.body as Buffer, copy.bytes)).toBe(0);
    }

    function pdfItem(copy: SignedCopy, exportedBy: HistoryItem['exportedBy']) {
      const signer = copy.signer;
      const label =
        signer.signerType === 'email' ? signer.email : signer.empidSnapshot;
      return {
        id: expect.any(String) as string,
        type: 'pdf',
        document: documentView(pdfDoc),
        exportedBy,
        exportedAt: expect.any(String) as string,
        scope: `${signer.nameSnapshot}（${label}）`,
        count: 1,
        signerPublicId: signer.publicId,
      };
    }

    it('建立人下載簽署人副本：回傳原本的 PDF 與標頭，並新增匯出人為建立人的紀錄', async () => {
      const before = (await pdfHistory()).total;
      const response = await download(
        creatorPath(externalCopy.signer),
        creatorCookie,
      ).expect(200);
      expectCompletedPdf(response, externalCopy);
      const page = await pdfHistory();
      expect(page.total).toBe(before + 1);
      expect(page.items[0]).toEqual(
        pdfItem(externalCopy, {
          name: creator.name,
          employeeNo: creator.empid,
          email: null,
        }),
      );
    });

    it('內部員工以員工 session 下載本人副本：匯出人與範圍都是該員工', async () => {
      const response = await download(
        selfPath(internalCopy.signer),
        await employeeCookie(internalUser),
      ).expect(200);
      expectCompletedPdf(response, internalCopy);
      expect((await pdfHistory()).items[0]).toEqual(
        pdfItem(internalCopy, {
          name: internalUser.name,
          employeeNo: internalUser.empid,
          email: null,
        }),
      );
    });

    it('外部簽署人以 Email OTP 存取下載本人副本：匯出人為姓名＋Email', async () => {
      const response = await download(
        externalPath,
        await externalCopyCookie(),
      ).expect(200);
      expectCompletedPdf(response, externalCopy);
      expect((await pdfHistory()).items[0]).toEqual(
        pdfItem(externalCopy, {
          name: externalCopy.signer.nameSnapshot,
          employeeNo: null,
          email: externalCopy.signer.email!,
        }),
      );
    });

    it('簽署人標籤超過 255 字時截斷', async () => {
      const name = '長'.repeat(100);
      const email = `${'a'.repeat(64)}@${'b'.repeat(60)}.${'c'.repeat(60)}.example.test`;
      const longCopy = await signedCopy(pdfDoc, {
        signerType: 'email',
        email,
        nameSnapshot: name,
        invitationTokenSha256: randomBytes(32).toString('hex'),
        sortOrder: 4,
      });
      const response = await download(
        creatorPath(longCopy.signer),
        creatorCookie,
      ).expect(200);
      expectCompletedPdf(response, longCopy);
      const { scope } = (await pdfHistory()).items[0];
      expect(scope).toHaveLength(255);
      expect(scope).toBe(`${name}（${email}`.slice(0, 255));
    });

    it('任何員工都能從 pdf 紀錄重新下載：回目前的副本，新紀錄沿用文件、簽署人與範圍，匯出人為目前使用者', async () => {
      const original = await insertRecord(
        {
          exportType: 'pdf',
          documentId: pdfDoc.id,
          createdByUserId: creator.id,
          signerId: externalCopy.signer.id,
          scopeDescription: '原紀錄的範圍說明',
          recordCount: 1,
        },
        new Date(Date.now() - 60_000),
      );
      const before = (await pdfHistory()).total;
      // 非建立人、也不是原匯出人。
      const response = await download(
        redownloadPath(original.publicId!),
        await employeeCookie(exporter),
      ).expect(200);
      expectCompletedPdf(response, externalCopy);
      const page = await pdfHistory();
      expect(page.total).toBe(before + 1);
      expect(page.items[0]).toEqual({
        ...pdfItem(externalCopy, {
          name: exporter.name,
          employeeNo: exporter.empid,
          email: null,
        }),
        scope: '原紀錄的範圍說明',
      });
      expect(page.items[0].id).not.toBe(original.publicId);
    });

    const withoutOrigin = (path: string, cookie: string) =>
      request(ctx.server).post(path).set('Cookie', cookie);
    it.each<{
      name: string;
      send: () => Promise<request.Response>;
      status: number;
      code: string;
    }>([
      {
        name: '非建立人以建立人路由下載',
        send: () => download(creatorPath(internalCopy.signer), viewerCookie),
        status: 404,
        code: 'ESIGN_RESOURCE_NOT_FOUND',
      },
      {
        name: '建立人下載尚未簽署的簽署人',
        send: () => download(creatorPath(pendingInternal), creatorCookie),
        status: 409,
        code: 'ESIGN_STATE_CONFLICT',
      },
      {
        name: '其他員工以本人路由下載',
        send: () => download(selfPath(internalCopy.signer), viewerCookie),
        status: 404,
        code: 'ESIGN_RESOURCE_NOT_FOUND',
      },
      {
        name: '本人尚未簽署',
        send: async () =>
          download(selfPath(pendingInternal), await employeeCookie(exporter)),
        status: 409,
        code: 'ESIGN_STATE_CONFLICT',
      },
      {
        name: '外部簽署人尚未簽署',
        send: async () =>
          download(externalPath, await accessCookie(pendingExternal)),
        status: 401,
        code: 'ESIGN_EXTERNAL_UNAUTHORIZED',
      },
      {
        name: '外部存取已失效',
        send: () => download(externalPath, externalCookie),
        status: 401,
        code: 'ESIGN_EXTERNAL_UNAUTHORIZED',
      },
      {
        name: '未登入呼叫建立人路由',
        send: () => download(creatorPath(internalCopy.signer)),
        status: 401,
        code: 'UNAUTHORIZED',
      },
      {
        name: '未登入呼叫本人路由',
        send: () => download(selfPath(internalCopy.signer)),
        status: 401,
        code: 'UNAUTHORIZED',
      },
      {
        name: '外部存取 cookie 呼叫本人路由',
        send: async () =>
          download(selfPath(internalCopy.signer), await externalCopyCookie()),
        status: 401,
        code: 'UNAUTHORIZED',
      },
      {
        name: '沒有外部存取 cookie',
        send: () => download(externalPath),
        status: 401,
        code: 'ESIGN_EXTERNAL_UNAUTHORIZED',
      },
      {
        name: '建立人路由缺 Origin',
        send: () =>
          withoutOrigin(creatorPath(internalCopy.signer), creatorCookie),
        status: 403,
        code: 'CSRF_ORIGIN_REJECTED',
      },
      {
        name: '本人路由缺 Origin',
        send: async () =>
          withoutOrigin(
            selfPath(internalCopy.signer),
            await employeeCookie(internalUser),
          ),
        status: 403,
        code: 'CSRF_ORIGIN_REJECTED',
      },
      {
        name: '外部路由缺 Origin',
        send: async () =>
          withoutOrigin(externalPath, await externalCopyCookie()),
        status: 403,
        code: 'CSRF_ORIGIN_REJECTED',
      },
      ...(['excel', 'zip'] as const).map((type) => ({
        name: `重新下載 ${type} 紀錄`,
        send: () =>
          download(redownloadPath(records[type].publicId!), viewerCookie),
        status: 404,
        code: 'ESIGN_RESOURCE_NOT_FOUND',
      })),
      {
        name: '重新下載不存在的紀錄',
        send: () => download(redownloadPath(randomUUID()), viewerCookie),
        status: 404,
        code: 'ESIGN_RESOURCE_NOT_FOUND',
      },
      {
        name: '重新下載格式不符的紀錄 id',
        send: () => download(redownloadPath('not-a-record'), viewerCookie),
        status: 404,
        code: 'ESIGN_RESOURCE_NOT_FOUND',
      },
      {
        name: '重新下載副本未產生的 pdf 紀錄',
        send: () =>
          download(redownloadPath(records.pendingPdf.publicId!), viewerCookie),
        status: 409,
        code: 'ESIGN_STATE_CONFLICT',
      },
      {
        name: '未登入重新下載',
        send: () => download(redownloadPath(records.pdf.publicId!)),
        status: 401,
        code: 'UNAUTHORIZED',
      },
      {
        name: '外部存取 cookie 重新下載',
        send: async () =>
          download(
            redownloadPath(records.pdf.publicId!),
            await externalCopyCookie(),
          ),
        status: 401,
        code: 'UNAUTHORIZED',
      },
      {
        name: '重新下載缺 Origin',
        send: () =>
          withoutOrigin(redownloadPath(records.pdf.publicId!), viewerCookie),
        status: 403,
        code: 'CSRF_ORIGIN_REJECTED',
      },
    ])(
      '$name：回 $status $code，不新增紀錄',
      async ({ send, status, code }) => {
        const before = (await pdfHistory()).total;
        const response = await send();
        expect(response.status).toBe(status);
        expect(apiError(response).code).toBe(code);
        expect((await pdfHistory()).total).toBe(before);
      },
    );

    it.each<{ name: string; send: () => Promise<request.Response> }>([
      {
        name: '建立人下載',
        send: () => download(creatorPath(externalCopy.signer), creatorCookie),
      },
      {
        name: '內部員工本人下載',
        send: async () =>
          download(
            selfPath(internalCopy.signer),
            await employeeCookie(internalUser),
          ),
      },
      {
        name: '外部簽署人本人下載',
        send: async () => download(externalPath, await externalCopyCookie()),
      },
      {
        name: '從紀錄重新下載',
        send: () =>
          download(redownloadPath(records.pdf.publicId!), viewerCookie),
      },
    ])('$name：紀錄寫入失敗回 500，不送出 PDF', async ({ send }) => {
      const before = (await pdfHistory()).total;
      const failure = jest
        .spyOn(ctx.app.get(ExportJobRepository), 'save')
        .mockRejectedValueOnce(new Error('合成紀錄寫入失敗'));
      try {
        const response = await send();
        expect(response.status).toBe(500);
        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(apiError(response).code).toBe('INTERNAL_ERROR');
        expect(failure).toHaveBeenCalledTimes(1);
      } finally {
        failure.mockRestore();
      }
      expect((await pdfHistory()).total).toBe(before);
    });
  });

  describe('Excel 紀錄', () => {
    const origin = 'http://localhost:3000';
    const conditions = {
      statuses: ['signed'],
      depts: ['營運部'],
      fields: ['name', 'employeeNo', 'dept', 'status', 'signedAt'],
    };
    let recorder: User;
    let recorderCookie: string;
    let excelDoc: EsignDocument;

    beforeAll(async () => {
      recorder = await manager.save(
        User,
        manager.create(User, {
          empid: `R${randomBytes(4).toString('hex')}`,
          name: '合成記錄員工',
          isActive: true,
        }),
      );
      recorderCookie = await employeeCookie(recorder);
      excelDoc = await createDocument('合成 Excel 記錄文件');
    });

    function record(body: Record<string, unknown>, cookie = recorderCookie) {
      return request(ctx.server)
        .post(historyPath)
        .set('Origin', origin)
        .set('Cookie', cookie)
        .send(body);
    }

    function validBody(document: EsignDocument = excelDoc) {
      return {
        type: 'excel',
        documentId: String(document.id),
        scope: '狀態：已簽署；部門：營運部',
        count: 120,
        conditions,
      };
    }

    /** 失敗的請求不得留下任何紀錄。 */
    async function expectNoNewRecord(send: () => Promise<unknown>) {
      const before = await manager.count(EsignExportJob);
      await send();
      expect(await manager.count(EsignExportJob)).toBe(before);
    }

    describe('記錄 Excel 匯出', () => {
      it('非建立人可記錄，匯出人取自 session，回 201 與查詢相同的 item', async () => {
        const response = await record(validBody()).expect(201);
        const item = apiData<HistoryItem>(response);
        expect(item).toEqual({
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ) as string,
          type: 'excel',
          document: documentView(excelDoc),
          exportedBy: {
            name: recorder.name,
            employeeNo: recorder.empid,
            email: null,
          },
          exportedAt: expect.any(String) as string,
          scope: '狀態：已簽署；部門：營運部',
          count: 120,
          conditions,
        });
        const listed = await history(`type=excel&documentId=${excelDoc.id}`);
        expect(listed.total).toBe(1);
        expect(listed.items).toEqual([item]);
      });

      it('文件為草稿、已刪除或不存在時回 404，不新增紀錄', async () => {
        const draft = await manager.save(
          EsignDocument,
          manager.create(EsignDocument, {
            docNumber: randomUUID(),
            title: '合成 Excel 草稿',
            status: 'draft',
            createdByUserId: creator.id,
          }),
        );
        const deleted = await createDocument('合成 Excel 已刪除文件');
        await manager.update(
          EsignDocument,
          { id: deleted.id },
          { deletedAt: new Date() },
        );
        for (const documentId of [
          String(draft.id),
          String(deleted.id),
          '999999999999999',
        ])
          await expectNoNewRecord(async () => {
            const response = await record({
              ...validBody(),
              documentId,
            }).expect(404);
            expect(apiError(response).code).toBe('ESIGN_RESOURCE_NOT_FOUND');
          });
      });

      const withConditions = (patch: Record<string, unknown>) => ({
        conditions: { ...conditions, ...patch },
      });
      it.each([
        ['未知欄位（前端傳入匯出人）', { createdByUserId: 1 }],
        ['conditions 內的未知欄位', withConditions({ signers: [] })],
        ['缺 conditions', { conditions: undefined }],
        ['conditions 為陣列', { conditions: [] }],
        ['未知狀態', withConditions({ statuses: ['signed', 'expired'] })],
        ['未知欄位鍵', withConditions({ fields: ['name', 'phone'] })],
        ['fields 為空', withConditions({ fields: [] })],
        ['重複的欄位鍵', withConditions({ fields: ['name', 'name'] })],
        ['depts 超過 500 個', withConditions({ depts: deptKeys(501, 3) })],
        ['部門鍵超過 255 字', withConditions({ depts: ['部'.repeat(256)] })],
        ['部門鍵為空字串', withConditions({ depts: [''] })],
        ['scope trim 後為空', { scope: '   ' }],
        ['scope 256 字', { scope: '範'.repeat(256) }],
        ['count 為 -1', { count: -1 }],
        ['count 為小數', { count: 1.5 }],
        ['count 為字串', { count: '120' }],
        ['type 為 pdf', { type: 'pdf' }],
        ['type 為 zip', { type: 'zip' }],
        ['documentId 格式錯誤', { documentId: 'abc' }],
      ])('%s 回 400 INVALID_REQUEST，不新增紀錄', async (_name, patch) => {
        await expectNoNewRecord(async () => {
          const response = await record({ ...validBody(), ...patch }).expect(
            400,
          );
          expect(apiError(response).code).toBe('INVALID_REQUEST');
        });
      });

      it('邊界值可記錄：scope trim 後 255 字、count 0、500 個 255 字部門鍵、全部狀態與欄位', async () => {
        const boundary = {
          statuses: ['pending', 'signed', 'rejected'],
          depts: deptKeys(500, 255),
          fields: [
            'name',
            'employeeNo',
            'dept',
            'title',
            'email',
            'status',
            'signedAt',
            'rejectedAt',
            'rejectReason',
          ],
        };
        const item = apiData<HistoryItem>(
          await record({
            ...validBody(),
            scope: ` ${'範'.repeat(255)} `,
            count: 0,
            conditions: boundary,
          }).expect(201),
        );
        expect(item).toMatchObject({
          scope: '範'.repeat(255),
          count: 0,
          conditions: boundary,
        });
      });

      it('缺 Origin 回 403，不新增紀錄', async () => {
        await expectNoNewRecord(async () => {
          const response = await request(ctx.server)
            .post(historyPath)
            .set('Cookie', recorderCookie)
            .send(validBody())
            .expect(403);
          expect(apiError(response).code).toBe('CSRF_ORIGIN_REJECTED');
        });
      });

      it('未登入與外部存取 cookie 回 401，不新增紀錄', async () => {
        await expectNoNewRecord(async () => {
          await request(ctx.server)
            .post(historyPath)
            .set('Origin', origin)
            .send(validBody())
            .expect(401);
          const response = await record(validBody(), externalCookie).expect(
            401,
          );
          expect(apiError(response).code).toBe('UNAUTHORIZED');
        });
      });
    });

    describe('Excel 重新下載資料', () => {
      const originalEndAt = new Date(Date.now() + 86_400_000);
      let sourceDoc: EsignDocument;
      let signedSigner: EsignSigner;
      let rejectedSigner: EsignSigner;
      let pendingSigner: EsignSigner;
      let excelRecordId: string;

      beforeAll(async () => {
        sourceDoc = await manager.save(
          EsignDocument,
          manager.create(EsignDocument, {
            docNumber: randomUUID(),
            title: '合成 Excel 重新下載文件',
            status: 'active',
            createdByUserId: creator.id,
            signStartAt: new Date(Date.now() - 86_400_000),
            // 重新開放後的截止時間晚於發起時固定的截止時間。
            signEndAt: new Date(originalEndAt.getTime() + 86_400_000),
            signingPayloadJson: {
              period: { endAt: originalEndAt.toISOString() },
            },
          }),
        );
        const prefix = randomBytes(4).toString('hex');
        const signer = (fields: Partial<EsignSigner>) =>
          manager.save(
            EsignSigner,
            manager.create(EsignSigner, {
              publicId: randomUUID(),
              documentId: sourceDoc.id,
              note: '合成管理備註',
              ...fields,
            }),
          );
        signedSigner = await signer({
          signerType: 'user',
          userId: internalUser.id,
          empidSnapshot: internalUser.empid,
          nameSnapshot: '合成內部已簽',
          departmentSnapshot: '營運部',
          titleSnapshot: '專員',
          email: `in-${prefix}@example.test`,
          status: 'signed',
          signedAt: new Date(Date.now() - 3_600_000),
          completionStatus: 'pending',
          sortOrder: 0,
        });
        rejectedSigner = await signer({
          signerType: 'email',
          email: `rejected-${prefix}@example.test`,
          nameSnapshot: '合成外部拒簽',
          status: 'rejected',
          rejectedAt: new Date(Date.now() - 1_800_000),
          rejectRequestId: randomUUID(),
          rejectReason: '條款不同意',
          sortOrder: 1,
        });
        pendingSigner = await signer({
          signerType: 'email',
          email: `pending-${prefix}@example.test`,
          nameSnapshot: '合成外部待簽',
          status: 'pending',
          sortOrder: 2,
        });
        await signer({
          signerType: 'email',
          email: `removed-${prefix}@example.test`,
          nameSnapshot: '合成已移除',
          status: 'pending',
          sortOrder: 3,
          deletedAt: new Date(),
        });
        excelRecordId = apiData<HistoryItem>(
          await record(validBody(sourceDoc)).expect(201),
        ).id;
      });

      function redownload(id: string, cookie?: string) {
        const call = request(ctx.server).get(`${historyPath}/${id}/document`);
        return cookie ? call.set('Cookie', cookie) : call;
      }

      it('任何員工可取得文件目前資料，只含產生 Excel 需要的欄位，不新增紀錄', async () => {
        // 非建立人、也不是原匯出人。
        const cookie = await employeeCookie(exporter);
        await expectNoNewRecord(async () => {
          const document = apiData<unknown>(
            await redownload(excelRecordId, cookie).expect(200),
          );
          expect(document).toEqual({
            id: String(sourceDoc.id),
            title: '合成 Excel 重新下載文件',
            docNumber: sourceDoc.docNumber,
            signStartAt: sourceDoc.signStartAt!.toISOString(),
            signEndAt: sourceDoc.signEndAt!.toISOString(),
            originalSignEndAt: originalEndAt.toISOString(),
            isReopened: true,
            createdBy: { name: creator.name, employeeNo: creator.empid },
            signers: [
              {
                type: 'user',
                name: '合成內部已簽',
                employeeNo: internalUser.empid,
                department: '營運部',
                title: '專員',
                email: signedSigner.email,
                status: 'signed',
                signedAt: signedSigner.signedAt!.toISOString(),
                rejectedAt: null,
                rejectReason: null,
              },
              {
                type: 'email',
                name: '合成外部拒簽',
                employeeNo: null,
                department: null,
                title: null,
                email: rejectedSigner.email,
                status: 'rejected',
                signedAt: null,
                rejectedAt: rejectedSigner.rejectedAt!.toISOString(),
                rejectReason: '條款不同意',
              },
              {
                type: 'email',
                name: '合成外部待簽',
                employeeNo: null,
                department: null,
                title: null,
                email: pendingSigner.email,
                status: 'pending',
                signedAt: null,
                rejectedAt: null,
                rejectReason: null,
              },
            ],
          });
        });
      });

      it('pdf／zip 紀錄、不存在的紀錄與文件已刪除時回 404', async () => {
        const pdf = await insertRecord(
          {
            exportType: 'pdf',
            documentId: sourceDoc.id,
            createdByUserId: creator.id,
            signerId: signedSigner.id,
            scopeDescription: `合成內部已簽（${internalUser.empid}）`,
            recordCount: 1,
          },
          new Date(),
        );
        const zip = await insertRecord(
          {
            exportType: 'signed_copies_zip',
            documentId: sourceDoc.id,
            createdByUserId: creator.id,
            scopeDescription: '此次簽署的所有已簽副本',
            recordCount: 1,
            snapshotAt: new Date(),
            snapshotJson: [],
            snapshotSha256: 'f'.repeat(64),
          },
          new Date(),
        );
        const removedDoc = await createDocument('合成 Excel 之後刪除的文件');
        const orphanId = apiData<HistoryItem>(
          await record(validBody(removedDoc)).expect(201),
        ).id;
        await manager.update(
          EsignDocument,
          { id: removedDoc.id },
          { deletedAt: new Date() },
        );
        for (const id of [
          pdf.publicId!,
          zip.publicId!,
          randomUUID(),
          'not-a-record',
          orphanId,
        ]) {
          const response = await redownload(id, viewerCookie).expect(404);
          expect(apiError(response).code).toBe('ESIGN_RESOURCE_NOT_FOUND');
        }
      });

      it('未登入與外部存取 cookie 回 401', async () => {
        await redownload(excelRecordId).expect(401);
        const response = await redownload(excelRecordId, externalCookie).expect(
          401,
        );
        expect(apiError(response).code).toBe('UNAUTHORIZED');
      });
    });
  });

  describe('ZIP 不受 excel／pdf 紀錄影響', () => {
    const origin = 'http://localhost:3000';
    interface ZipJob {
      id: string;
      status: string;
      failureCode: string | null;
      expectedCount: number;
      files: Array<{ downloadPath: string }>;
    }

    it('同一文件已有 excel／pdf 紀錄時，ZIP 申請、重試、下載與重用不變，worker 與維護掃描不選中也不更新新類型', async () => {
      const zipDoc = await createSignableDocument('合成 ZIP 隔離文件');
      const copy = await signedCopy(zipDoc, {
        signerType: 'email',
        email: `zip-${randomBytes(4).toString('hex')}@example.test`,
        nameSnapshot: 'ZIP 簽署人',
        sortOrder: 0,
      });
      const exportsPath = `/api/esign/documents/${zipDoc.id}/exports`;
      const post = (path: string) =>
        request(ctx.server)
          .post(path)
          .set('Origin', origin)
          .set('Cookie', viewerCookie);
      const get = (path: string) =>
        request(ctx.server).get(path).set('Cookie', viewerCookie);
      const zipJob = async (jobId: string, status: string) => {
        for (let i = 0; i < 200; i++) {
          const job = apiData<ZipJob>(
            await get(`${exportsPath}/${jobId}`).expect(200),
          );
          if (job.status === status) return job;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`ZIP 工作未進入 ${status}`);
      };
      const totals = async () =>
        (await history(`type=zip&documentId=${zipDoc.id}`)).typeTotals;
      const newTypeRows = () =>
        manager.query<Array<{ public_id: string }>>(
          "SELECT * FROM esign_export_jobs WHERE document_id = ? AND export_type IN ('excel','pdf') ORDER BY id",
          [zipDoc.id],
        );

      // 經 API 寫入的 excel 與 pdf 紀錄。
      await post(historyPath)
        .send({
          type: 'excel',
          documentId: String(zipDoc.id),
          scope: '全部',
          count: 1,
          conditions: { statuses: [], depts: [], fields: ['name'] },
        })
        .expect(201);
      await request(ctx.server)
        .post(
          `/api/esign/documents/${zipDoc.id}/signers/${copy.signer.publicId}/completed-file/downloads`,
        )
        .set('Origin', origin)
        .set('Cookie', await employeeCookie(creator))
        .expect(200);
      // 最壞情況：狀態欄位看起來像排隊中、租約已過期的 ZIP 工作，但沒有快照。
      const lookalikes = [
        await insertRecord(
          {
            exportType: 'excel',
            documentId: zipDoc.id,
            createdByUserId: exporter.id,
            status: 'pending',
            completedAt: null,
            scopeDescription: '全部',
            recordCount: 1,
            conditionsJson: { statuses: [], depts: [], fields: ['name'] },
          },
          new Date(),
        ),
        await insertRecord(
          {
            exportType: 'pdf',
            documentId: zipDoc.id,
            signerId: copy.signer.id,
            status: 'processing',
            completedAt: null,
            leaseToken: randomUUID(),
            leaseExpiresAt: new Date(0),
            scopeDescription: 'ZIP 簽署人',
            recordCount: 1,
          },
          new Date(),
        ),
      ];
      const before = await newTypeRows();
      expect(before).toHaveLength(4);
      expect(await totals()).toEqual({ excel: 2, pdf: 2, zip: 0 });

      // 來源副本暫時遺失，讓工作先失敗，以驗證重試。
      const sourcePath = join(process.env.ESIGN_STORAGE_ROOT!, copy.objectKey);
      await rm(sourcePath);
      const requested = apiData<ZipJob>(
        await post(exportsPath).send({ type: 'signed_copies_zip' }).expect(202),
      );
      expect(requested.expectedCount).toBe(1);
      const worker = await NestFactory.createApplicationContext(WorkerModule, {
        logger: false,
      });
      try {
        expect(await zipJob(requested.id, 'failed')).toMatchObject({
          failureCode: 'ESIGN_EXPORT_UNAVAILABLE',
        });
        // ZIP 路由不接受 excel／pdf 紀錄。
        for (const { public_id } of before) {
          await get(`${exportsPath}/${public_id}`).expect(404);
          await post(`${exportsPath}/${public_id}/retries`).expect(404);
        }
        await writeFile(sourcePath, copy.bytes);
        expect(
          apiData<ZipJob>(
            await post(`${exportsPath}/${requested.id}/retries`).expect(202),
          ).id,
        ).toBe(requested.id);
        const completed = await zipJob(requested.id, 'completed');
        expect(completed.expectedCount).toBe(1);
        await get(completed.files[0].downloadPath).expect(200);
        // 下載不新增紀錄；zip 只依匯出工作計數。
        expect(await totals()).toEqual({ excel: 2, pdf: 2, zip: 1 });
        expect(
          apiData<ZipJob>(
            await post(exportsPath)
              .send({ type: 'signed_copies_zip' })
              .expect(200),
          ).id,
        ).toBe(requested.id);
        // 歷史的重新下載與 Excel 資料不接受 ZIP 工作。
        await post(`${historyPath}/${requested.id}/downloads`).expect(404);
        await get(`${historyPath}/${requested.id}/document`).expect(404);

        await worker.get(DocumentExportProcessor).maintain();
        expect(await newTypeRows()).toEqual(before);
        expect(await totals()).toEqual({ excel: 2, pdf: 2, zip: 1 });
      } finally {
        await worker.close();
        await manager.delete(
          EsignExportJob,
          lookalikes.map((job) => job.id),
        );
      }
    });
  });
});

/** 產生不重複、指定長度的部門鍵。 */
function deptKeys(count: number, length: number) {
  return Array.from({ length: count }, (_, index) =>
    String(index).padStart(length, '部'),
  );
}
