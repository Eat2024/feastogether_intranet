import { PortalDirectoryService } from '#app/infrastructure/portal/portal-directory.service';
import { AuthorizationService } from '#app/features/authorization/services/authorization.service';
import { ExportHistoryController } from './export-history.controller';
import { EsignExportHistoryService } from '../services/esign-export-history.service';
import { InitiationJobRepository } from '../repositories/initiation-job.repository';
import { Readable } from 'node:stream';
import fastifyCookie from '@fastify/cookie';
import { getQueueToken } from '@nestjs/bullmq';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { validationExceptionFactory } from '#app/common/errors/validation-exception.factory';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { SessionService } from '#app/features/auth/services/session.service';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { AuthGuard } from '#app/framework/guards/auth.guard';
import { ResponseInterceptor } from '#app/framework/interceptors/response.interceptor';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { PRIVATE_FILE_STORAGE } from '#app/infrastructure/file-storage/private-file-storage.port';
import { EsignDocument } from '../entities/esign-document.entity';
import { ESIGN_EXPORT_QUEUE } from '../esign-queue.constants';
import { DocumentRepository } from '../repositories/document.repository';
import { ExportJobRepository } from '../repositories/export-job.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { EsignAccessPolicyService } from '../services/esign-access-policy.service';
import { EsignDocumentValidationService } from '../services/esign-document-validation.service';
import { EsignExportService } from '../services/esign-export.service';
import { ExportsController } from './exports.controller';

describe('準備匯出檔名（真 controller／service／policy／guard）', () => {
  let app: NestFastifyApplication;
  let document: EsignDocument | null;
  const authenticate = jest.fn();
  const employeeSession = (userId: number) => ({
    actor: { kind: 'employee', userId },
    user: { id: userId },
    expiresAt: new Date(Date.now() + 60_000),
  });
  const redownloadPdf = jest.fn();
  const recordDownloadFileName = jest.fn();
  const pdfUrl =
    '/api/esign/history/export/00000000-0000-4000-8000-000000000021/downloads';
  const headers = {
    cookie: `${AUTH_COOKIE_NAME}=session`,
    origin: 'http://localhost:3000',
  };
  const url = '/api/esign/documents/9/export-downloads';
  const exportId = '00000000-0000-4000-8000-000000000020';
  const downloadPath = `/api/esign/documents/9/exports/${exportId}/files/1`;
  let jobStatus = 'completed';
  const file = {
    id: 1,
    exportJobId: 1,
    originalFileName: 'original.zip',
    fileSize: 4,
    sha256: 'abc',
    archiveStatus: 'active',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExportsController, ExportHistoryController],
      providers: [
        // 本套件只驗檔名契約；能力矩陣由真 HTTP/DB 的 authorization-colleague 測試負責。
        {
          provide: AuthorizationService,
          useValue: { requirePermissions: () => Promise.resolve() },
        },
        { provide: EsignExportHistoryService, useValue: { redownloadPdf } },
        {
          provide: InitiationJobRepository,
          useValue: { active: jest.fn().mockResolvedValue(null) },
        },
        EsignExportService,
        EsignAccessPolicyService,
        EsignDocumentValidationService,
        { provide: PortalDirectoryService, useValue: {} },
        { provide: MysqlService, useValue: { getManager: () => ({}) } },
        { provide: DocumentRepository, useValue: { findById: () => document } },
        {
          provide: UserRepository,
          useValue: {
            findById: () =>
              Object.assign(new User(), {
                id: 7,
                isActive: true,
                departmentCode: 'D01',
                deletedAt: null,
              }),
          },
        },
        {
          provide: ExportJobRepository,
          useValue: {
            find: (id: string, docId: number) =>
              id === exportId && docId === 9
                ? {
                    id: 1,
                    status: jobStatus,
                    completedAt: jobStatus === 'completed' ? new Date() : null,
                    snapshotJson: [],
                  }
                : null,
            files: () => [file],
            recordDownloadFileName,
          },
        },
        { provide: FileObjectRepository, useValue: {} },
        {
          provide: PRIVATE_FILE_STORAGE,
          useValue: {
            stat: () => ({ fileSize: 4 }),
            openReadStream: (
              _file: unknown,
              range?: { start: number; end: number },
            ) =>
              Readable.from(
                range
                  ? Buffer.from('test').subarray(range.start, range.end + 1)
                  : Buffer.from('test'),
              ),
          },
        },
        { provide: getQueueToken(ESIGN_EXPORT_QUEUE), useValue: {} },
        {
          provide: ConfigService,
          useValue: new ConfigService({ AUTH_TRUSTED_ORIGINS: headers.origin }),
        },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    app.useLogger(false);
    app.useGlobalGuards(
      new AuthGuard(
        { authenticate } as unknown as SessionService,
        { isActive: () => false } as unknown as ClsService,
        module.get(Reflector),
      ),
    );
    await app.register(fastifyCookie);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => {
    redownloadPdf.mockReset().mockResolvedValue({
      bytes: Buffer.from('%PDF-test'),
      fileName: '原檔.pdf',
    });
    recordDownloadFileName.mockReset().mockResolvedValue({ affected: 1 });
    jobStatus = 'completed';
    authenticate.mockResolvedValue(employeeSession(7));
    document = Object.assign(new EsignDocument(), {
      id: 9,
      status: 'active',
      createdByDepartmentCode: 'D01',
      deletedAt: null,
    });
  });
  afterAll(async () => {
    await app.close();
  });
  it.each([
    undefined,
    {},
    { fileName: '' },
    { fileName: '  ' },
    { fileName: '年度.PDF' },
  ])('歷史 PDF 支援預設與當次名稱：%p', async (payload) => {
    const response = await app.inject({
      method: 'POST',
      url: pdfUrl,
      headers,
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('%PDF-test');
    const expected = payload?.fileName?.trim() ? '年度.pdf' : '原檔.pdf';
    expect(response.headers['content-disposition']).toContain(
      encodeURIComponent(expected),
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(redownloadPdf).toHaveBeenCalledTimes(1);
    expect(redownloadPdf).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000021',
      7,
    );
  });
  it.each([
    { fileName: null },
    { fileName: '../x' },
    { fileName: 'x\n' },
    { fileName: 'a'.repeat(101) },
    { fileName: 'CON' },
    { unknown: 'x' },
  ])('歷史 PDF 拒絕非法名稱或未知欄位：%p', async (payload) => {
    const response = await app.inject({
      method: 'POST',
      url: pdfUrl,
      headers,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(redownloadPdf).not.toHaveBeenCalled();
  });
  it('歷史 PDF 命名仍要求 session 與同源請求', async () => {
    const missingOrigin = await app.inject({
      method: 'POST',
      url: pdfUrl,
      headers: { cookie: headers.cookie },
      payload: { fileName: '年度' },
    });
    expect(missingOrigin.statusCode).toBe(403);
    authenticate.mockResolvedValue(null);
    const unauthorized = await app.inject({
      method: 'POST',
      url: pdfUrl,
      headers,
      payload: { fileName: '年度' },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(redownloadPdf).not.toHaveBeenCalled();
  });
  it('ZIP 準備驗證成功才保存正規化檔名；失敗不保存', async () => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { type: 'zip', exportId, fileId: '1', fileName: '首次.XLSX' },
    });
    expect(response.statusCode).toBe(200);
    expect(recordDownloadFileName).toHaveBeenCalledWith(
      1,
      '首次.zip',
      expect.anything(),
    );
    recordDownloadFileName.mockClear();
    const invalid = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { type: 'zip', exportId, fileId: '1', fileName: '../bad' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(recordDownloadFileName).not.toHaveBeenCalled();
    jobStatus = 'processing';
    const pending = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { type: 'zip', exportId, fileId: '1', fileName: '首次' },
    });
    expect(pending.statusCode).toBe(409);
    expect(recordDownloadFileName).not.toHaveBeenCalled();
  });
  it('ZIP 直接下載記錄預設名稱，無效 Range 不保存', async () => {
    const invalid = await app.inject({
      method: 'GET',
      url: downloadPath,
      headers: { ...headers, range: 'bytes=99-100' },
    });
    expect(invalid.statusCode).toBe(416);
    expect(recordDownloadFileName).not.toHaveBeenCalled();
    const response = await app.inject({
      method: 'GET',
      url: downloadPath,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(recordDownloadFileName).toHaveBeenCalledWith(
      1,
      'original.zip',
      expect.anything(),
    );
  });
  it('授權員工可以取得當次 Excel 名稱，無需寫入儲存或 queue', async () => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { type: 'excel', fileName: '年度紀錄' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toMatchObject({
      success: true,
      data: { type: 'excel', fileName: '年度紀錄.xlsx' },
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it.each([undefined, '', '   '])('未指定名稱回 null：%p', async (fileName) => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: {
        type: 'excel',
        ...(fileName === undefined ? {} : { fileName }),
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toMatchObject({
      data: { type: 'excel', fileName: null },
    });
  });
  it.each([
    { type: 'pdf' },
    { type: 'excel', fileName: null },
    { type: 'excel', fileName: ['x'] },
    { type: 'excel', exportId: 'x' },
    { type: 'excel', fileId: '1' },
    { type: 'excel', unknown: true },
    { type: 'excel', fileName: '../sensitive-name' },
  ])('拒絕不合法 body：%p', async (payload) => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('sensitive-name');
  });
  it('無員工 session、失效 session 不授權；Super user 回 403', async () => {
    const payload = { type: 'excel' };
    expect(
      (await app.inject({ method: 'POST', url, payload })).statusCode,
    ).toBe(401);
    authenticate.mockResolvedValue(null);
    expect(
      (await app.inject({ method: 'POST', url, headers, payload })).statusCode,
    ).toBe(401);
    authenticate.mockResolvedValue({
      actor: { kind: 'super_user' },
      user: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      (await app.inject({ method: 'POST', url, headers, payload })).statusCode,
    ).toBe(403);
  });
  it('缺少或不允許的來源不授權', async () => {
    const payload = { type: 'excel' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload,
          headers: { cookie: headers.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload,
          headers: { ...headers, origin: 'https://other.example' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it.each(['missing', 'draft', 'deleted', 'other-department'])(
    '不可見文件回 404：%s',
    async (state) => {
      if (state === 'missing') document = null;
      else if (document) {
        if (state === 'draft') document.status = 'draft';
        if (state === 'deleted') document.deletedAt = new Date();
        if (state === 'other-department')
          document.createdByDepartmentCode = 'D02';
      }
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers,
            payload: { type: 'excel' },
          })
        ).statusCode,
      ).toBe(404);
    },
  );
  it('ZIP 準備只回當次檔名與不含名稱的下載路徑', async () => {
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: {
        type: 'zip',
        fileName: '年度副本.xlsx',
        exportId,
        fileId: '1',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toMatchObject({
      success: true,
      data: {
        type: 'zip',
        fileName: '年度副本.zip',
        downloadPath: `${downloadPath}?downloadName=client`,
      },
    });
  });

  it('ZIP client 命名保留 Range 串流，但不設定伺服器檔名', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${downloadPath}?downloadName=client`,
      headers: { ...headers, range: 'bytes=1-2' },
    });
    expect(response.statusCode).toBe(206);
    expect(response.headers['content-disposition']).toBe('attachment');
    expect(response.headers['content-range']).toBe('bytes 1-2/4');
    expect(response.headers.etag).toBe('"abc"');
    expect(response.body).toBe('es');
  });

  it.each([
    { type: 'zip' },
    { type: 'zip', exportId },
    { type: 'zip', exportId: null, fileId: '1' },
    { type: 'zip', exportId: [exportId], fileId: '1' },
    { type: 'zip', exportId, fileId: null },
    { type: 'zip', exportId, fileId: ['1'] },
    { type: 'zip', exportId, fileId: 1 },
    { type: 'zip', exportId, fileId: '9007199254740992' },
    { type: 'excel', exportId },
    { type: 'excel', exportId: null },
    { type: 'excel', fileId: null },
  ])('拒絕不符類型的 ZIP 識別欄位：%p', async (payload) => {
    expect(
      (await app.inject({ method: 'POST', url, headers, payload })).statusCode,
    ).toBe(400);
  });
  it('空白 ZIP 名稱沿用成果，錯誤歸屬與未就緒成果拒絕', async () => {
    const payload = { type: 'zip', exportId, fileId: '1', fileName: '  ' };
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<unknown>()).toMatchObject({
      data: { type: 'zip', fileName: 'original.zip', downloadPath },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...payload, fileId: '2' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: {
            ...payload,
            exportId: '00000000-0000-4000-8000-000000000021',
          },
        })
      ).statusCode,
    ).toBe(404);
    jobStatus = 'pending';
    expect(
      (await app.inject({ method: 'POST', url, headers, payload })).statusCode,
    ).toBe(409);
  });
  it.each([
    'downloadName=server',
    'downloadName=client&downloadName=client',
    'fileName=private-name',
  ])('拒絕非法下載參數：%s', async (query) => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `${downloadPath}?${query}`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
  });
  it('原 GET 命名、If-Range 與 416 行為保持，準備後 session 失效仍拒絕下載', async () => {
    const original = await app.inject({
      method: 'GET',
      url: downloadPath,
      headers,
    });
    expect(original.statusCode).toBe(200);
    expect(original.headers['content-disposition']).toContain('original.zip');
    const mismatched = await app.inject({
      method: 'GET',
      url: `${downloadPath}?downloadName=client`,
      headers: { ...headers, range: 'bytes=0-1', 'if-range': '"other"' },
    });
    expect(mismatched.statusCode).toBe(200);
    expect(mismatched.body).toBe('test');
    const invalidRange = await app.inject({
      method: 'GET',
      url: `${downloadPath}?downloadName=client`,
      headers: { ...headers, range: 'bytes=4-' },
    });
    expect(invalidRange.statusCode).toBe(416);
    expect(invalidRange.headers['content-range']).toBe('bytes */4');
    await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { type: 'zip', exportId, fileId: '1' },
    });
    authenticate.mockResolvedValue(null);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `${downloadPath}?downloadName=client`,
          headers,
        })
      ).statusCode,
    ).toBe(401);
  });
});
