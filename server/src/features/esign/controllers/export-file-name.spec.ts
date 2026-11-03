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
import { AuthService } from '#app/features/auth/services/auth.service';
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
  const verifySessionToken = jest.fn();
  const headers = {
    cookie: `${AUTH_COOKIE_NAME}=session`,
    origin: 'http://localhost:3000',
  };
  const url = '/api/esign/documents/9/export-downloads';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExportsController],
      providers: [
        EsignExportService,
        EsignAccessPolicyService,
        EsignDocumentValidationService,
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
        { provide: ExportJobRepository, useValue: {} },
        { provide: FileObjectRepository, useValue: {} },
        { provide: PRIVATE_FILE_STORAGE, useValue: {} },
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
        { verifySessionToken } as unknown as AuthService,
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
    verifySessionToken.mockResolvedValue({ userId: 7 });
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
  it('無員工 session、失效 session 或外部身分不授權', async () => {
    const payload = { type: 'excel' };
    expect(
      (await app.inject({ method: 'POST', url, payload })).statusCode,
    ).toBe(401);
    verifySessionToken.mockResolvedValue(null);
    expect(
      (await app.inject({ method: 'POST', url, headers, payload })).statusCode,
    ).toBe(401);
    verifySessionToken.mockResolvedValue({ signerPublicId: 'external' });
    expect(
      (await app.inject({ method: 'POST', url, headers, payload })).statusCode,
    ).toBe(401);
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
});
