import { randomUUID } from 'node:crypto';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { FeastogetherClient } from '#app/infrastructure/http-client/feastogether/feastogether.client';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { User } from '#app/features/users/entities/user.entity';
import { In } from 'typeorm';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { assertTestRedisDb } from '#app/infrastructure/database/test/ensure-test-redis';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  SecurityE2eContext,
} from './security-e2e.helper';

const route = '/api/esign/signer-candidates';
const headers = {
  cookie: `${AUTH_COOKIE_NAME}=synthetic-resolution-session`,
  origin: 'http://localhost:3000',
};

describe('員工解析 HTTP', () => {
  let ctx: SecurityE2eContext;
  const employeeNos: string[] = [];
  const source = { get: jest.fn() };
  const employeeNo = () => {
    const value = randomUUID().replaceAll('-', '').slice(0, 8);
    employeeNos.push(value);
    return value;
  };
  beforeAll(async () => {
    assertTestRedisDb();
    ctx = await createSecurityE2eApp((builder) =>
      builder
        .overrideProvider(FeastogetherClient)
        .useValue(source)
        .overrideProvider(AuthService)
        .useValue({
          verifySessionToken: (token: string) =>
            Promise.resolve(
              token === 'synthetic-resolution-session' ? { userId: 1 } : null,
            ),
        }),
    );
  });
  beforeEach(() => source.get.mockReset());
  afterAll(async () => {
    if (ctx) {
      if (employeeNos.length)
        await ctx.app
          .get(MysqlService)
          .getManager()
          .delete(User, { empid: In(employeeNos) });
      await closeSecurityE2eApp(ctx);
    }
  });

  it('GET 查無完整員編仍為唯讀，不呼叫來源或匯入帳號', async () => {
    const empid = '0' + String(Date.now()).slice(-7);
    employeeNos.push(empid);
    source.get.mockResolvedValue([
      {
        person_empid: empid,
        person_name: '合成員工',
        person_status: 1,
        person_status_name: '正式',
      },
    ]);
    const response = await ctx.app.inject({
      method: 'GET',
      url: `${route}?q=${empid}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: unknown }>().data).toEqual([]);
    expect(source.get).not.toHaveBeenCalled();
  });

  it('POST 解析完整員編並依首次順序去重，結果不含信箱', async () => {
    const empid = employeeNo();
    source.get.mockResolvedValue([
      {
        person_empid: empid,
        person_name: '合成員工',
        person_status: 1,
        person_status_name: '正式',
        department_name: '合成部門',
        title: null,
      },
    ]);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `${route}/resolutions`,
      headers,
      payload: { employeeNos: [empid, empid, 'missingTooLong'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: unknown }>().data).toEqual({
      items: [
        {
          employeeNo: empid,
          userId: expect.any(String) as unknown,
          name: '合成員工',
          department: '合成部門',
          title: null,
          status: 'resolved',
        },
        {
          employeeNo: 'missingTooLong',
          userId: null,
          name: null,
          department: null,
          title: null,
          status: 'unavailable',
        },
      ],
    });
    const search = await ctx.app.inject({
      method: 'GET',
      url: `${route}?q=${empid}`,
      headers,
    });
    expect(search.json<{ data: unknown[] }>().data).toHaveLength(1);
    source.get.mockRejectedValue(new Error('來源不應再被查詢'));
    const repeat = await ctx.app.inject({
      method: 'POST',
      url: `${route}/resolutions`,
      headers,
      payload: { employeeNos: [empid] },
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json<{ data: { items: unknown[] } }>().data.items).toEqual([
      response.json<{ data: { items: unknown[] } }>().data.items[0],
    ]);
  });

  it('來源錯誤轉為穩定 502，不洩漏來源內容或當作登入錯誤', async () => {
    source.get.mockRejectedValue(new Error('synthetic-private-source-body'));
    const response = await ctx.app.inject({
      method: 'POST',
      url: `${route}/resolutions`,
      headers,
      payload: { employeeNos: [employeeNo()] },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'ESIGN_EMPLOYEE_DIRECTORY_UNAVAILABLE',
    );
    expect(response.body).not.toContain('synthetic-private');
  });

  it('已停用、軟刪除、本機長員編與前導零依本機身分解析，只有範圍內缺帳號者查來源', async () => {
    const manager = ctx.app.get(MysqlService).getManager();
    const disabled = employeeNo();
    const deleted = employeeNo();
    const leading = `00${employeeNo()}Long`;
    employeeNos.push(leading);
    await manager.save(User, [
      manager.create(User, {
        empid: disabled,
        name: '合成停用員工',
        isActive: false,
      }),
      manager.create(User, {
        empid: deleted,
        name: '合成刪除員工',
        isActive: true,
        deletedAt: new Date(),
      }),
      manager.create(User, {
        empid: leading,
        name: '合成長員編',
        isActive: true,
      }),
    ]);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `${route}/resolutions`,
      headers,
      payload: { employeeNos: [disabled, deleted, leading, 'short', '1234'] },
    });
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json<{ data: { items: { employeeNo: string; status: string }[] } }>()
        .data.items.map(({ employeeNo, status }) => ({ employeeNo, status })),
    ).toEqual([
      { employeeNo: disabled, status: 'unavailable' },
      { employeeNo: deleted, status: 'unavailable' },
      { employeeNo: leading, status: 'resolved' },
      { employeeNo: 'short', status: 'unavailable' },
      { employeeNo: '1234', status: 'unavailable' },
    ]);
    expect(source.get).toHaveBeenCalledTimes(1);
  });

  it('並發解析同員編只回同一帳號，GET 也只看到一人', async () => {
    const empid = employeeNo();
    source.get.mockResolvedValue([
      {
        person_empid: empid,
        person_name: '合成並發員工',
        person_status: 0,
        person_status_name: '試用',
      },
    ]);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.app.inject({
          method: 'POST',
          url: `${route}/resolutions`,
          headers,
          payload: { employeeNos: [empid] },
        }),
      ),
    );
    expect(results.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(
      new Set(
        results.map(
          (response) =>
            response.json<{ data: { items: { userId: string }[] } }>().data
              .items[0].userId,
        ),
      ).size,
    ).toBe(1);
    const search = await ctx.app.inject({
      method: 'GET',
      url: `${route}?q=${empid}`,
      headers,
    });
    expect(search.json<{ data: unknown[] }>().data).toHaveLength(1);
  });

  it.each([
    {},
    { employeeNos: [] },
    { employeeNos: Array(101).fill('00123') },
    { employeeNos: [12345] },
    { employeeNos: [' 00123'] },
    { employeeNos: ['a'.repeat(21)] },
    { employeeNos: ['員工'] },
    { employeeNos: ['00123'], email: 'override@example.invalid' },
  ])('格式錯誤先拒絕且不查來源 %j', async (payload) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `${route}/resolutions`,
      headers,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(source.get).not.toHaveBeenCalled();
  });

  it('缺少 session、跨站或無 Origin 拒絕且不查來源', async () => {
    for (const [requestHeaders, status] of [
      [{ origin: headers.origin }, 401],
      [{ ...headers, origin: 'https://cross-site.invalid' }, 403],
      [{ cookie: headers.cookie }, 403],
    ] as const) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: `${route}/resolutions`,
        headers: requestHeaders,
        payload: { employeeNos: ['00123'] },
      });
      expect(response.statusCode).toBe(status);
    }
    expect(source.get).not.toHaveBeenCalled();
  });

  it('來源非精確相符、資格不符或重複皆不建立帳號', async () => {
    const empid = employeeNo();
    for (const rows of [
      [],
      Array.from({ length: 2 }, () => ({
        person_empid: empid,
        person_name: '合成重複員工',
        person_status: 1,
        person_status_name: '正式',
      })),
      [
        {
          person_empid: 'other123',
          person_name: '合成員工',
          person_status: 1,
          person_status_name: '正式',
        },
      ],
      [
        {
          person_empid: empid,
          person_name: '合成員工',
          person_status: 3,
          person_status_name: '離職',
        },
      ],
    ]) {
      source.get.mockResolvedValue(rows);
      const response = await ctx.app.inject({
        method: 'POST',
        url: `${route}/resolutions`,
        headers,
        payload: { employeeNos: [empid] },
      });
      expect(response.statusCode).toBe(200);
      expect(
        response.json<{ data: { items: { status: string }[] } }>().data.items[0]
          .status,
      ).toBe('unavailable');
    }
    const search = await ctx.app.inject({
      method: 'GET',
      url: `${route}?q=${empid}`,
      headers,
    });
    expect(search.json<{ data: unknown[] }>().data).toEqual([]);
  });

  it('可接受 100 個與 1／20 碼邊界，去重後保留完整字串', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `${route}/resolutions`,
      headers,
      payload: {
        employeeNos: ['0', ...Array<string>(99).fill('00000000000000000001')],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(
      response
        .json<{ data: { items: { employeeNo: string }[] } }>()
        .data.items.map((item) => item.employeeNo),
    ).toEqual(['0', '00000000000000000001']);
    expect(source.get).not.toHaveBeenCalled();
  });

  it('後續來源失敗不回部分結果，先前已合法建帳者可在重試復用', async () => {
    const first = employeeNo();
    const second = employeeNo();
    source.get
      .mockResolvedValueOnce([
        {
          person_empid: first,
          person_name: '合成先建帳員工',
          person_status: 1,
          person_status_name: '正式',
        },
      ])
      .mockRejectedValueOnce(new Error('synthetic-unavailable'));
    const failed = await ctx.app.inject({
      method: 'POST',
      url: `${route}/resolutions`,
      headers,
      payload: { employeeNos: [first, second] },
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json<unknown>()).not.toHaveProperty('data');
    source.get.mockReset().mockResolvedValue([]);
    const retry = await ctx.app.inject({
      method: 'POST',
      url: `${route}/resolutions`,
      headers,
      payload: { employeeNos: [first, second] },
    });
    expect(retry.statusCode).toBe(200);
    expect(
      retry
        .json<{ data: { items: { status: string }[] } }>()
        .data.items.map((item) => item.status),
    ).toEqual(['resolved', 'unavailable']);
    expect(source.get).toHaveBeenCalledTimes(1);
  });

  it('Swagger 描述解析成功 envelope 與穩定錯誤', () => {
    const document = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    const responses = document.paths[`${route}/resolutions`].post?.responses;
    expect(responses?.['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['success', 'data', 'timestamp'],
            properties: {
              data: {
                $ref: '#/components/schemas/SignerCandidateResolutionsDto',
              },
            },
          },
        },
      },
    });
    for (const code of ['400', '401', '403', '502'])
      expect(responses).toHaveProperty(code);
  });
});
