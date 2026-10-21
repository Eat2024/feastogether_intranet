import { EsignReopeningService } from '../services/esign-reopening.service';
import fastifyMultipart from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AuthGuard } from '#app/framework/guards/auth.guard';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { validationExceptionFactory } from '#app/common/errors/validation-exception.factory';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentsController } from '../controllers/documents.controller';
import { EsignDraftService } from '../services/esign-draft.service';
import { EsignDocumentQueryService } from '../services/esign-document-query.service';
import { EsignSignerService } from '../services/esign-signer.service';
import { EsignFieldService } from '../services/esign-field.service';
import { EsignInitiationService } from '../services/esign-initiation.service';
import { EsignStoppageService } from '../services/esign-stoppage.service';
import { EsignCompletionAccessService } from '../services/esign-completion-access.service';

type Part = { name: string; value: string; filename?: string };
function multipart(parts: Part[]) {
  return (
    parts
      .map(
        (part) =>
          `--test-boundary\r\nContent-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}\r\n${part.filename ? 'Content-Type: application/pdf\r\n' : ''}\r\n${part.value}\r\n`,
      )
      .join('') + '--test-boundary--\r\n'
  );
}
const title = { name: 'title', value: '測試文件' };
const file = { name: 'file', filename: 'test.pdf', value: '%PDF-test' };

describe('DocumentUploadInterceptor（Nest/Fastify HTTP 整合）', () => {
  let app: NestFastifyApplication;
  const drafts = { create: jest.fn(), update: jest.fn() };
  const queries = { creatorDetail: jest.fn() };
  const verifySessionToken = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        { provide: EsignDraftService, useValue: drafts },
        { provide: EsignDocumentQueryService, useValue: queries },
        { provide: EsignReopeningService, useValue: {} },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            AUTH_TRUSTED_ORIGINS: 'http://localhost:3000',
          }),
        },
        ...[
          EsignSignerService,
          EsignFieldService,
          EsignInitiationService,
          EsignStoppageService,
          EsignCompletionAccessService,
        ].map((provide) => ({ provide, useValue: {} })),
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
    await app.register(fastifyMultipart, {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    });
    // 使用真 Guard／decorator／pipe，僅替換 session 查詢與業務服務，不連接 DB。
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    verifySessionToken.mockResolvedValue({ userId: 7 });
    drafts.create.mockResolvedValue({ id: 9 });
    drafts.update.mockResolvedValue(undefined);
    queries.creatorDetail.mockResolvedValue({ id: '9', status: 'draft' });
  });
  afterAll(async () => {
    await app.close();
  });

  const send = (
    parts: Part[],
    method: 'POST' | 'PATCH' = 'POST',
    origin = 'http://localhost:3000',
  ) =>
    app.inject({
      method,
      url:
        method === 'POST' ? '/api/esign/documents' : '/api/esign/documents/9',
      headers: {
        origin,
        cookie: `${AUTH_COOKIE_NAME}=test-session`,
        'content-type': 'multipart/form-data; boundary=test-boundary',
      },
      payload: multipart(parts),
    });

  it.each([
    [title, file],
    [file, title],
  ])('建立草稿：欄位與檔案順序不影響解析', async (...parts) => {
    const response = await send(parts);
    expect(response.statusCode).toBe(201);
    expect(drafts.create).toHaveBeenCalledWith({
      title: title.value,
      creatorUserId: 7,
      bytes: Buffer.from(file.value),
      originalFileName: file.filename,
      contentType: 'application/pdf',
    });
    expect(response.json()).toEqual({ id: '9' });
    expect(queries.creatorDetail).not.toHaveBeenCalled();
  });
  it('修改可僅傳標題，不要求 PDF', async () => {
    const response = await send([title], 'PATCH');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: '9' });
    expect(queries.creatorDetail).not.toHaveBeenCalled();
    expect(drafts.update).toHaveBeenCalledWith(9, 7, {
      title: title.value,
      file: undefined,
    });
  });
  it('修改可僅替換 PDF，不要求標題', async () => {
    expect((await send([file], 'PATCH')).statusCode).toBe(200);
    expect(drafts.update).toHaveBeenCalledWith(9, 7, {
      title: undefined,
      file: {
        bytes: Buffer.from(file.value),
        originalFileName: file.filename,
        contentType: 'application/pdf',
      },
    });
  });
  const placement = {
    type: 'date',
    page: 1,
    xPercent: 10,
    yPercent: 20,
    widthPercent: 30,
    heightPercent: 5,
    sortOrder: 0,
  };
  const fieldsPart = (value: string) => ({ name: 'fields', value });
  it('建立草稿可在同一個 multipart 帶入 fields JSON', async () => {
    const response = await send([
      title,
      file,
      fieldsPart(JSON.stringify([placement])),
    ]);
    expect(response.statusCode).toBe(201);
    expect(drafts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: title.value,
        fields: [expect.objectContaining(placement)],
      }),
    );
  });
  it('修改可僅傳 fields，不要求標題或 PDF', async () => {
    const response = await send(
      [fieldsPart(JSON.stringify([placement]))],
      'PATCH',
    );
    expect(response.statusCode).toBe(200);
    expect(drafts.update).toHaveBeenCalledWith(9, 7, {
      title: undefined,
      file: undefined,
      fields: [expect.objectContaining(placement)],
    });
  });
  it.each([
    ['不是 JSON', 'not-json'],
    ['不是陣列', JSON.stringify(placement)],
    ['頁碼不合法', JSON.stringify([{ ...placement, page: 0 }])],
    ['欄位類型不合法', JSON.stringify([{ ...placement, type: 'stamp' }])],
    [
      '帶入簽署人',
      JSON.stringify([
        {
          ...placement,
          signerPublicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
        },
      ]),
    ],
    [
      '超過 200 個',
      JSON.stringify(Array.from({ length: 201 }, () => placement)),
    ],
  ])('fields %s 時由 DTO 拒絕', async (_case, value) => {
    for (const method of ['POST', 'PATCH'] as const) {
      const response = await send([title, file, fieldsPart(value)], method);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_REQUEST' });
    }
    expect(drafts.create).not.toHaveBeenCalled();
    expect(drafts.update).not.toHaveBeenCalled();
  });
  it.each([
    [[title], '請上傳 PDF 文件'],
    [[title, { ...file, name: 'unexpected' }], '不支援的欄位：unexpected'],
    [[file, { name: 'unexpected', value: 'x' }], '不支援的欄位：unexpected'],
  ] as [Part[], string][])('無效輸入不呼叫業務寫入', async (parts, message) => {
    const response = await send(parts);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message });
    expect(drafts.create).not.toHaveBeenCalled();
  });
  it.each(['POST', 'PATCH'] as const)(
    '%s 的 title 由 DTO 拒絕空白及過長內容',
    async (method) => {
      for (const value of ['', '   ', 'x'.repeat(201)]) {
        const response = await send([file, { ...title, value }], method);
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: 'INVALID_REQUEST' });
        expect(drafts.create).not.toHaveBeenCalled();
        expect(drafts.update).not.toHaveBeenCalled();
      }
    },
  );
  it('建立時 title 必填，由 DTO 阻擋', async () => {
    const response = await send([file]);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_REQUEST' });
    expect(drafts.create).not.toHaveBeenCalled();
  });
  it('DTO 去除標題前後空白', async () => {
    expect(
      (await send([file, { ...title, value: '  文件  ' }])).statusCode,
    ).toBe(201);
    expect(drafts.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: '文件', creatorUserId: 7 }),
    );
  });
  it('Guard 拒絕無效身分，不進入上傳解析或業務寫入', async () => {
    verifySessionToken.mockResolvedValueOnce({ userId: 0 });
    expect((await send([{ ...file, name: 'unexpected' }])).statusCode).toBe(
      401,
    );
    expect(drafts.create).not.toHaveBeenCalled();
  });
  it('缺少登入 cookie 時先回 401，不進入 DTO 或業務寫入', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/esign/documents',
    });
    expect(response.statusCode).toBe(401);
    expect(verifySessionToken).not.toHaveBeenCalled();
    expect(drafts.create).not.toHaveBeenCalled();
  });
  it('重複檔案仍受 multipart 單檔限制', async () => {
    expect((await send([title, file, file])).statusCode).toBe(413);
    expect(drafts.create).not.toHaveBeenCalled();
  });
  it('超過 20 MiB 不進入 service', async () => {
    expect(
      (
        await send([
          title,
          { ...file, value: 'x'.repeat(20 * 1024 * 1024 + 1) },
        ])
      ).statusCode,
    ).toBe(413);
    expect(drafts.create).not.toHaveBeenCalled();
  });
  it('OriginGuard 先拒絕，不先解析無效上傳', async () => {
    expect(
      (
        await send(
          [{ ...file, name: 'unexpected' }],
          'POST',
          'https://untrusted.test',
        )
      ).statusCode,
    ).toBe(403);
    expect(drafts.create).not.toHaveBeenCalled();
  });
});
