import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { EMPLOYEE_INELIGIBLE_EVENT } from './auth-security-event.service';
import { AuthService } from './auth.service';

describe('AuthService WebView SSO', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const publicKeyB64 = Buffer.from(
    publicKey.export({ type: 'spki', format: 'pem' }),
  ).toString('base64');
  const manager = {};

  const setup = () => {
    const configValues: Record<string, string> = {
      WEBVIEW_JWT_ISSUER: 'main-platform',
      WEBVIEW_JWT_AUDIENCE: 'esign',
      WEBVIEW_JWT_PUBLIC_KEY_B64: publicKeyB64,
      WEBVIEW_LAUNCH_ORIGIN: 'https://esign.example.test',
    };
    const config = { get: jest.fn((key: string) => configValues[key]) };
    const sessions = {
      createValidating: jest.fn().mockResolvedValue({ id: 1 }),
      markPending: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const user = {
      id: 7,
      empid: '00123',
      name: '王小明',
      isActive: true,
      deletedAt: null,
      departmentName: '資訊部',
      titleName: '工程師',
      lastLoginAt: new Date('2026-01-01T00:00:00Z'),
    };
    const users = {
      findByEmpidForUpdate: jest.fn().mockResolvedValue(null),
      create: jest.fn((fields) => ({ ...fields })),
      save: jest.fn().mockResolvedValue(user),
    };
    const mysql = {
      transaction: jest.fn((run) => run(manager)),
      getManager: jest.fn().mockReturnValue(manager),
    };
    const staff = {
      person_empid: '00123',
      person_name: '王小明',
      person_status: 1,
      person_status_name: '正式',
      department_id: 'IT',
      department_name: '資訊部',
      title: '工程師',
    };
    const eligibleStaff = {
      lookupEligibleStaff: jest.fn().mockResolvedValue(staff),
    };
    const logger = { info: jest.fn() };
    const events = { recordRejection: jest.fn() };
    return {
      service: new AuthService(
        config as never,
        sessions as never,
        users as never,
        mysql as never,
        eligibleStaff as never,
        logger as never,
        events as never,
      ),
      config,
      sessions,
      users,
      mysql,
      eligibleStaff,
      events,
      user,
    };
  };

  const jwt = (overrides: Record<string, unknown> = {}, header = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const encodedHeader = encode({
      alg: 'RS256',
      typ: 'FT-ESIGN-LAUNCH+JWT',
      ...header,
    });
    const encodedPayload = encode({
      iss: 'main-platform',
      aud: 'esign',
      sub: '00123',
      jti: '550e8400-e29b-41d4-a716-446655440000',
      iat: now,
      nbf: now,
      exp: now + 120,
      ...overrides,
    });
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      privateKey,
    ).toString('base64url');
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  };

  it('公鑰設定不是有效 RSA 公鑰時啟動失敗', () => {
    const { service: _service, config, ...dependencies } = setup();
    config.get.mockImplementation((key: string) => {
      if (key === 'WEBVIEW_JWT_ISSUER') return 'main-platform';
      if (key === 'WEBVIEW_JWT_AUDIENCE') return 'esign';
      if (key === 'WEBVIEW_JWT_PUBLIC_KEY_B64') return 'invalid';
      return 'https://esign.example.test';
    });
    expect(
      () =>
        new AuthService(
          config as never,
          dependencies.sessions as never,
          dependencies.users as never,
          dependencies.mysql as never,
          dependencies.eligibleStaff as never,
          { info: jest.fn() } as never,
          dependencies.events as never,
        ),
    ).toThrow('WEBVIEW_JWT_PUBLIC_KEY_B64 必須是有效 RSA 公鑰 PEM');
  });

  it('有效 JWT 先 claim jti，再查員工資料並建立 43 字元 launch code', async () => {
    const { service, sessions, eligibleStaff } = setup();
    const result = await service.createWebviewLaunch(jwt());
    expect(result.launchUrl).toMatch(
      /^https:\/\/esign\.example\.test\/api\/auth\/webview\?code=[A-Za-z0-9_-]{43}$/,
    );
    expect(sessions.createValidating).toHaveBeenCalledWith(
      createHash('sha256')
        .update('main-platform' + '\0' + '550e8400-e29b-41d4-a716-446655440000')
        .digest('hex'),
      expect.any(Date),
      manager,
    );
    expect(eligibleStaff.lookupEligibleStaff).toHaveBeenCalledWith('00123');
    expect(sessions.markPending).toHaveBeenCalledWith(
      1,
      7,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(Date),
      expect.any(Date),
      manager,
    );
  });

  it.each([
    [{ alg: 'HS256' }, {}],
    [{ kid: 'unknown' }, {}],
    [{}, { iss: 'other' }],
    [{}, { aud: ['esign'] }],
    [{}, { sub: '00123-' }],
    [{}, { empid: '00123' }],
    [{}, { jti: 'not-uuid-v4' }],
    [{}, { exp: Math.floor(Date.now() / 1000) + 180 }],
  ])('錯誤 header/claim 在 FGAPI 與 DB 前拒絕', async (header, claims) => {
    const { service, mysql, eligibleStaff } = setup();
    await expect(
      service.createWebviewLaunch(jwt(claims, header)),
    ).rejects.toMatchObject({
      code: AppErrorCode.AUTH_EXCHANGE_FAILED,
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(mysql.transaction).not.toHaveBeenCalled();
    expect(eligibleStaff.lookupEligibleStaff).not.toHaveBeenCalled();
  });

  it.each([
    { iss: undefined },
    { aud: undefined },
    { sub: undefined },
    { jti: undefined },
    { iat: undefined },
    { nbf: undefined },
    { exp: undefined },
    { iat: 1.5 },
    { nbf: '0' },
    { exp: -1 },
  ])('缺少或格式錯誤的必要 claim 在外部呼叫前拒絕：%p', async (claims) => {
    const { service, mysql, eligibleStaff } = setup();
    await expect(
      service.createWebviewLaunch(jwt(claims)),
    ).rejects.toMatchObject({ code: AppErrorCode.AUTH_EXCHANGE_FAILED });
    expect(mysql.transaction).not.toHaveBeenCalled();
    expect(eligibleStaff.lookupEligibleStaff).not.toHaveBeenCalled();
  });

  it.each([
    { iat: 1_800_000_031, nbf: 1_800_000_000, exp: 1_800_000_120 },
    { iat: 1_800_000_000, nbf: 1_800_000_031, exp: 1_800_000_120 },
    { iat: 1_799_999_849, nbf: 1_799_999_849, exp: 1_799_999_969 },
    { iat: 1_800_000_000, nbf: 1_800_000_000, exp: 1_800_000_121 },
  ])('超出 JWT 時間容忍或最大壽命時拒絕：%p', async (claims) => {
    jest.useFakeTimers().setSystemTime(new Date(1_800_000_000 * 1000));
    try {
      const { service, mysql, eligibleStaff } = setup();
      await expect(
        service.createWebviewLaunch(jwt(claims)),
      ).rejects.toMatchObject({ code: AppErrorCode.AUTH_EXCHANGE_FAILED });
      expect(mysql.transaction).not.toHaveBeenCalled();
      expect(eligibleStaff.lookupEligibleStaff).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('接受 JWT 時間容忍與最長壽命的邊界值', async () => {
    jest.useFakeTimers().setSystemTime(new Date(1_800_000_000 * 1000));
    try {
      const { service } = setup();
      await expect(
        service.createWebviewLaunch(
          jwt({
            iat: 1_800_000_030,
            nbf: 1_800_000_030,
            exp: 1_800_000_150,
          }),
        ),
      ).resolves.toMatchObject({ expiresAt: expect.any(Date) });
    } finally {
      jest.useRealTimers();
    }
  });

  it('拒絕簽章遭竄改的 JWT，且不查員工資料或 DB', async () => {
    const { service, mysql, eligibleStaff } = setup();
    const token = jwt();
    const [header, payload, encodedSignature] = token.split('.');
    const signature = Buffer.from(encodedSignature, 'base64url');
    signature[0] ^= 1;
    const forged = `${header}.${payload}.${signature.toString('base64url')}`;
    await expect(service.createWebviewLaunch(forged)).rejects.toMatchObject({
      code: AppErrorCode.AUTH_EXCHANGE_FAILED,
    });
    expect(mysql.transaction).not.toHaveBeenCalled();
    expect(eligibleStaff.lookupEligibleStaff).not.toHaveBeenCalled();
  });

  it.each(['001a_B-02', 'IT'])(
    '新增帳號保存可信部門原字串 %s',
    async (code) => {
      const { service, eligibleStaff, users } = setup();
      eligibleStaff.lookupEligibleStaff.mockResolvedValue({
        person_empid: '00123',
        person_name: '合成員工',
        person_status: 1,
        person_status_name: '正式',
        department_id: code,
        department_name: '合成部門',
        title: null,
      });
      await service.createWebviewLaunch(jwt());
      expect(users.save).toHaveBeenCalledWith(
        expect.objectContaining({
          departmentCode: code,
          departmentName: '合成部門',
        }),
        manager,
      );
    },
  );

  it('缺部門（EligibleStaffService 給 null）清除既有代碼與名稱，不沿用舊授權', async () => {
    const { service, eligibleStaff, users, user } = setup();
    users.findByEmpidForUpdate.mockResolvedValue({
      ...user,
      departmentId: 42,
      departmentCode: 'OLD',
      departmentName: '舊部門',
    });
    eligibleStaff.lookupEligibleStaff.mockResolvedValue({
      person_empid: '00123',
      person_name: '合成員工',
      person_status: 1,
      person_status_name: '正式',
      department_id: null,
      department_name: null,
      title: null,
    });
    await service.createWebviewLaunch(jwt());
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        departmentId: 42,
        departmentCode: null,
        departmentName: null,
      }),
      manager,
    );
  });

  it('登入同步不寫入未選取的 email', async () => {
    const { service, users, user } = setup();
    users.findByEmpidForUpdate.mockResolvedValue({ ...user });
    await service.createWebviewLaunch(jwt());
    const saved = (users.save.mock.calls[0] as unknown[])[0];
    expect(saved).not.toHaveProperty('email');
  });

  it.each([
    [
      'Portal 查詢失敗',
      new AppException(...AppErrors.STAFF_LOOKUP_FAILED),
      HttpStatus.BAD_GATEWAY,
    ],
    ['未預期錯誤', new Error('合成上游失敗'), HttpStatus.SERVICE_UNAVAILABLE],
  ])(
    '員工資料%s不寫入帳號，launch 標記失敗，不記拒絕事件',
    async (_case, failure, status) => {
      const { service, eligibleStaff, users, sessions, events } = setup();
      eligibleStaff.lookupEligibleStaff.mockRejectedValue(failure);
      await expect(service.createWebviewLaunch(jwt())).rejects.toMatchObject({
        status,
      });
      expect(users.save).not.toHaveBeenCalled();
      expect(sessions.markPending).not.toHaveBeenCalled();
      expect(sessions.markFailed).toHaveBeenCalled();
      expect(events.recordRejection).not.toHaveBeenCalled();
    },
  );

  it('Portal 判定不可登入：launch 先標記失敗再記匿名拒絕事件', async () => {
    const { service, eligibleStaff, sessions, events } = setup();
    eligibleStaff.lookupEligibleStaff.mockRejectedValue(
      new AppException(...AppErrors.AUTH_EXCHANGE_FAILED),
    );
    await expect(service.createWebviewLaunch(jwt())).rejects.toMatchObject({
      code: AppErrorCode.AUTH_EXCHANGE_FAILED,
    });
    expect(events.recordRejection).toHaveBeenCalledWith(
      EMPLOYEE_INELIGIBLE_EVENT,
    );
    expect(sessions.markFailed.mock.invocationCallOrder[0]).toBeLessThan(
      events.recordRejection.mock.invocationCallOrder[0],
    );
  });

  it('既有 User 只更新員工資料白名單欄位並保留 departmentId', async () => {
    const { service, users } = setup();
    const existing = {
      id: 7,
      empid: '00123',
      name: '舊姓名',
      isActive: true,
      deletedAt: null,
      departmentId: 42,
      departmentName: '舊部門',
      titleName: '舊職稱',
      localOnly: '保留',
    };
    users.findByEmpidForUpdate.mockResolvedValue(existing);
    users.save.mockImplementation((value) => Promise.resolve(value));
    await service.createWebviewLaunch(jwt());
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        departmentId: 42,
        localOnly: '保留',
        name: '王小明',
        departmentName: '資訊部',
        departmentCode: 'IT',
        titleName: '工程師',
      }),
      manager,
    );
  });

  it('首次建檔的 MySQL deadlock 只重試一次整筆 User 交易', async () => {
    const { service, mysql, sessions } = setup();
    mysql.transaction
      .mockImplementationOnce((run) => run(manager))
      .mockRejectedValueOnce({ driverError: { code: 'ER_LOCK_DEADLOCK' } })
      .mockImplementationOnce((run) => run(manager));

    await expect(service.createWebviewLaunch(jwt())).resolves.toMatchObject({
      launchUrl: expect.stringContaining('/api/auth/webview?code='),
    });
    expect(mysql.transaction).toHaveBeenCalledTimes(3);
    expect(sessions.markFailed).not.toHaveBeenCalled();
  });

  it.each([
    { isActive: false, deletedAt: null },
    { isActive: true, deletedAt: new Date() },
  ])(
    'inactive／soft-deleted User fail closed 並記匿名拒絕事件：%p',
    async (state) => {
      const { service, users, sessions, events } = setup();
      users.findByEmpidForUpdate.mockResolvedValue({
        id: 7,
        empid: '00123',
        name: '王小明',
        ...state,
      });
      await expect(service.createWebviewLaunch(jwt())).rejects.toMatchObject({
        code: AppErrorCode.AUTH_EXCHANGE_FAILED,
      });
      expect(sessions.markPending).not.toHaveBeenCalled();
      expect(sessions.markFailed).toHaveBeenCalled();
      expect(events.recordRejection).toHaveBeenCalledWith(
        EMPLOYEE_INELIGIBLE_EVENT,
      );
    },
  );
});
