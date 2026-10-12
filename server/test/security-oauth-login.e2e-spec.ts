import { randomBytes } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { AuthLogoutService } from '#app/features/auth/services/auth-logout.service';
import { AuthSessionVerifierService } from '#app/features/auth/services/auth-session-verifier.service';
import { AuthSessionService } from '#app/features/auth/services/auth-session.service';
import { AuthService } from '#app/features/auth/services/auth.service';
import { OauthIdentityService } from '#app/features/auth/services/oauth-identity.service';
import { OauthLoginService } from '#app/features/auth/services/oauth-login.service';
import { OauthTransactionService } from '#app/features/auth/services/oauth-transaction.service';
import { InfrastructureModule } from '#app/infrastructure/infrastructure.module';
import { OauthModule } from '#app/infrastructure/http-client/oauth/oauth.module';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FrameworkModule } from '#app/framework/framework.module';
import * as oidcStub from './stubs/openid-client.stub';

@Module({
  imports: [
    FrameworkModule,
    InfrastructureModule,
    OauthModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [
    OauthIdentityService,
    OauthTransactionService,
    AuthSessionService,
    AuthSessionVerifierService,
    AuthService,
    AuthLogoutService,
    OauthLoginService,
  ],
})
class AuthTestingModule {}

describe('dormant SSO/session testing module', () => {
  const empid = 'SYN-SPEC1';

  beforeAll(() => {
    process.env.OAUTH_ISSUER = 'https://auth.example.com';
    process.env.OAUTH_CLIENT_ID = 'spec1-client';
    process.env.OAUTH_CLIENT_SECRET = 'synthetic-secret';
    process.env.OAUTH_REDIRECT_URI = 'http://localhost:3000/oauth/callback';
    process.env.OAUTH_LOGOUT_URL = 'https://auth.example.com/logout';
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  it('驗證 state/nonce 一次性、empid mapping、session 與 logout', async () => {
    oidcStub.resetOidcStub();
    oidcStub.authorizationCodeGrant.mockResolvedValue(
      oidcStub.tokensOf({ userNumber: empid, sub: 'spec1-sub' }),
    );
    oidcStub.fetchUserInfo.mockResolvedValue(
      oidcStub.userInfoOf({ userNumber: empid, sub: 'spec1-sub' }),
    );

    const testingModule = await Test.createTestingModule({
      imports: [AuthTestingModule],
    }).compile();
    await testingModule.init();
    const dataSource = testingModule.get<DataSource>(MYSQL_MAIN);
    try {
      const login = testingModule.get(OauthLoginService);
      const verifier = testingModule.get(AuthSessionVerifierService);
      const logout = testingModule.get(AuthLogoutService);
      const userRepository = testingModule.get(UserRepository);

      const started = await login.start('/documents');
      const state = new URL(started.authorizationUrl).searchParams.get('state');
      expect(state).toBeTruthy();
      expect(
        new URL(started.authorizationUrl).searchParams.get('nonce'),
      ).toBeTruthy();

      const completed = await login.getAccessTokenAndUserInfo(
        { code: 'synthetic-code', state: state! },
        started.browserToken,
      );
      expect(completed.session.user.empId).toBe(empid);
      await expect(
        verifier.verifySessionToken(completed.accessToken),
      ).resolves.toMatchObject({ userId: completed.session.user.id });

      await expect(
        login.getAccessTokenAndUserInfo(
          { code: 'synthetic-code', state: state! },
          started.browserToken,
        ),
      ).rejects.toMatchObject({ code: AppErrorCode.OAUTH_TRANSACTION_INVALID });

      await expect(logout.logout(completed.accessToken)).resolves.toMatchObject(
        {
          localLogout: 'completed',
        },
      );
      await expect(
        verifier.verifySessionToken(completed.accessToken),
      ).resolves.toBeNull();

      const user = await userRepository.findByEmpid(empid, dataSource.manager);
      expect(user).toMatchObject({ empid, isActive: true });
    } finally {
      await dataSource.query('DELETE FROM users WHERE empid = ?', [empid]);
      await testingModule.close();
    }
  });
});
