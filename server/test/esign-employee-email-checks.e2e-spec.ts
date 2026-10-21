import { HttpService } from '@nestjs/axios';
import { randomBytes } from 'node:crypto';
import { of, throwError } from 'rxjs';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('Spec010 草稿員工信箱檢查 API', () => {
  let ctx: SecurityE2eContext;
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let otherId: string;
  let documentId: string;
  const origin = 'http://localhost:3000';
  const empid = `00${randomBytes(6).toString('hex')}`;
  const http = { get: jest.fn(), post: jest.fn() };
  const check = (body: object, auth = cookie, id = documentId) =>
    request(ctx.server)
      .post(`/api/esign/documents/${id}/employee-email-checks`)
      .set('Cookie', auth)
      .set('Origin', origin)
      .send(body);
  const detail = async () =>
    apiData<unknown>(
      await request(ctx.server)
        .get(`/api/esign/documents/${documentId}`)
        .set('Cookie', cookie)
        .expect(200),
    );

  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(HttpService).useValue(http),
    );
    const manager = ctx.app.get(MysqlService).getManager();
    const users = await manager.save(User, [
      manager.create(User, {
        empid: `${empid}1`,
        name: '信箱測試甲',
        isActive: true,
      }),
      manager.create(User, {
        empid: `${empid}2`,
        name: '信箱測試乙',
        isActive: true,
      }),
    ]);
    [userId, otherId] = users.map((user) => String(user.id));
    const auth = ctx.app.get(AuthService);
    cookie = `${AUTH_COOKIE_NAME}=${(await auth.issueSession(Number(userId))).token}`;
    otherCookie = `${AUTH_COOKIE_NAME}=${(await auth.issueSession(Number(otherId))).token}`;
    const pdf = await PDFDocument.create();
    pdf.addPage();
    documentId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '信箱檢查合成草稿')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'email.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
  });
  beforeEach(() => {
    http.post.mockReset().mockReturnValue(
      of({
        data: {
          success: true,
          data: [
            { person_empid: `${empid}2`, email: 'shared@example.test' },
            { person_empid: `${empid}1`, email: 'shared@example.test' },
          ],
        },
      }),
    );
  });
  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  it('建立人取得逐人遮罩結果與 no-store，檢查不修改草稿', async () => {
    const before = await detail();
    const response = await check({ userIds: [userId, otherId, userId] }).expect(
      200,
    );
    expect(apiData<unknown>(response)).toEqual({
      items: [
        { userId, status: 'ready', maskedEmail: 's***@example.test' },
        { userId: otherId, status: 'ready', maskedEmail: 's***@example.test' },
      ],
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.text).not.toContain('shared@');
    expect(await detail()).toEqual(before);
  });

  it('未登入、非建立人、缺少文件與無 Origin 都不查來源', async () => {
    await check({ userIds: [userId] }, '').expect(401);
    await check({ userIds: [userId] }, otherCookie).expect(404);
    await check({ userIds: [userId] }, cookie, '999999999').expect(404);
    await request(ctx.server)
      .post(`/api/esign/documents/${documentId}/employee-email-checks`)
      .set('Cookie', cookie)
      .send({ userIds: [userId] })
      .expect(403);
    expect(http.post).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { userIds: '1' },
    { userIds: [] },
    { userIds: [1] },
    { userIds: ['01'] },
    { userIds: Array(6001).fill('1') },
    { userIds: ['1'], email: 'override@example.test' },
  ])('拒絕非法請求或來源覆寫 %#', async (body) => {
    const response = await check(body).expect(400);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('ID 超出安全整數範圍仍由 service 拒絕，不查來源', async () => {
    const response = await check({ userIds: ['9007199254740992'] }).expect(422);
    expect(response.body).toMatchObject({
      error: { code: 'ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE' },
    });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('不存在帳號 422 只列原請求 ID，來源失敗 502 不冒充登入失效', async () => {
    const invalid = await check({ userIds: [userId, '999999999'] }).expect(422);
    expect(invalid.body).toMatchObject({
      error: {
        code: 'ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE',
        details: { userIds: ['999999999'] },
      },
    });
    expect(http.post).not.toHaveBeenCalled();
    http.post.mockReturnValue(
      throwError(() => ({
        isAxiosError: true,
        response: { status: 401, data: 'private-data' },
      })),
    );
    const failed = await check({ userIds: [userId] }).expect(502);
    expect(failed.body).toMatchObject({
      error: { code: 'ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE' },
    });
    expect(failed.text).not.toContain('private-data');
  });

  it('空來源為 unavailable；重新查詢不使用 Email 快取', async () => {
    http.post.mockReturnValue(of({ data: { success: true, data: [] } }));
    expect(
      apiData<unknown>(await check({ userIds: [userId] }).expect(200)),
    ).toEqual({
      items: [{ userId, status: 'unavailable', maskedEmail: null }],
    });
    http.post.mockReturnValue(
      of({
        data: {
          success: true,
          data: [{ person_empid: `${empid}1`, email: 'new@example.test' }],
        },
      }),
    );
    expect(
      apiData<unknown>(await check({ userIds: [userId] }).expect(200)),
    ).toEqual({
      items: [{ userId, status: 'ready', maskedEmail: 'n***@example.test' }],
    });
  });

  it('Swagger 包含認證及成功／錯誤契約', () => {
    const api = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    const operation =
      api.paths['/api/esign/documents/{documentId}/employee-email-checks']
        .post!;
    for (const status of [
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '422',
      '502',
    ])
      expect(operation.responses[status]).toBeDefined();
    expect(operation.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/EmployeeEmailCheckResponseDto',
          },
        },
      },
    });
    expect(
      api.components?.schemas?.EmployeeEmailCheckResponseDto,
    ).toMatchObject({
      required: ['success', 'timestamp', 'data'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        timestamp: { type: 'string', format: 'date-time' },
        data: { $ref: '#/components/schemas/EmployeeEmailCheckResultDto' },
      },
    });
    expect(api.components?.schemas?.EmployeeEmailCheckResultDto).toMatchObject({
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            $ref: '#/components/schemas/EmployeeEmailCheckItemDto',
          },
        },
      },
    });
    expect(api.components?.schemas?.EmployeeEmailCheckItemDto).toMatchObject({
      required: ['userId', 'status', 'maskedEmail'],
      properties: {
        userId: { type: 'string' },
        status: { type: 'string', enum: ['ready', 'unavailable'] },
        maskedEmail: { type: 'string', nullable: true },
      },
    });
  });

  it('非草稿回 409 且不查來源', async () => {
    const manager = ctx.app.get(MysqlService).getManager();
    await manager.query(
      "UPDATE esign_documents SET status='active', sign_start_at='2026-01-01', sign_end_at='2099-01-01' WHERE id=?",
      [documentId],
    );
    await check({ userIds: [userId] }).expect(409);
    expect(http.post).not.toHaveBeenCalled();
  });
});
