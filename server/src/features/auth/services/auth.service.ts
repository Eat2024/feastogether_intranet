import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import {
  AUTH_SESSION_STATUS,
  type AuthSession as AuthSessionEntity,
} from '#app/features/auth/entities/auth-session.entity';
import { AuthSessionRepository } from '#app/features/auth/repositories/auth-session.repository';
import { isDuplicateEntryError } from '#app/features/auth/repositories/oauth-identity.repository';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { FeastogetherAuthService } from '#app/infrastructure/http-client/feastogether/services/feastogether-auth.service';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import type { StaffLookupDto } from '#app/infrastructure/http-client/feastogether/types/staff-lookup.dto';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import {
  WEBVIEW_JWT_CLOCK_TOLERANCE_SECONDS,
  WEBVIEW_JWT_MAX_TTL_SECONDS,
  WEBVIEW_JWT_TYPE,
  WEBVIEW_LAUNCH_TTL_SECONDS,
  WEBVIEW_SESSION_TTL_SECONDS,
} from '../auth.constants';
import { WebviewLaunchView } from '../dto/webview-launch.dto';

interface LaunchClaims {
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  iat: number;
  nbf: number;
  exp: number;
  name?: string;
}

export interface AuthSession {
  user: {
    id: number;
    empId: string;
    name: string;
    departmentName: string | null;
    titleName: string | null;
    lastLoginAt: Date | null;
  };
  expiresAt: Date;
}

export interface VerifiedIdentity {
  userId: number;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly publicKey: KeyObject;
  private readonly launchOrigin: string;

  constructor(
    config: ConfigService,
    private readonly sessions: AuthSessionRepository,
    private readonly users: UserRepository,
    private readonly mysql: MysqlService,
    private readonly hr: FeastogetherHrService,
    private readonly logger: AppLoggerService,
    private readonly passwordAuth: FeastogetherAuthService,
  ) {
    const webviewConfig = this.getConfig(config);
    this.issuer = webviewConfig.iss;
    this.audience = webviewConfig.aud;
    this.publicKey = this.readPublicKey(webviewConfig.key);
    this.launchOrigin = webviewConfig.launch;
  }

  /** 帳密驗證後沿用 WebView 的員工資格與本地帳號規則，再發本系統 session。 */
  async login(
    empId: string,
    password: string,
  ): Promise<{ token: string; session: AuthSession }> {
    await this.passwordAuth.authenticate(empId, password);
    const staff = await this.hr.lookupEligibleStaff(empId);
    const saveUser = () =>
      this.mysql.transaction((manager) =>
        this.findOrCreateUser(empId, staff, new Date(), manager),
      );
    let user: User;
    try {
      user = await saveUser();
    } catch (error) {
      if (!this.isUserCreationRace(error)) throw error;
      user = await saveUser();
    }
    const issued = await this.issueSession(Number(user.id));
    return {
      token: issued.token,
      session: this.buildSession(user, issued.expiresAt),
    };
  }

  async createWebviewLaunch(token: string): Promise<WebviewLaunchView> {
    const { jti, exp, sub } = this.verifyLaunchJwt(token);
    const sourceJtiHash = this.digest(`${this.issuer}\0${jti}`);
    let session: AuthSessionEntity;
    try {
      session = await this.mysql.transaction((manager) =>
        this.sessions.createValidating(
          sourceJtiHash,
          new Date(exp * 1000),
          manager,
        ),
      );
    } catch (error) {
      if (isDuplicateEntryError(error)) {
        this.audit('auth.webview_launch_replayed');
        throw this.exchangeFailed();
      }
      throw this.databaseUnavailable();
    }

    try {
      const staff = await this.hr.lookupEligibleStaff(sub);
      const issued = await this.resolveUserAndIssueCode(
        Number(session.id),
        sub,
        staff,
      );
      this.audit('auth.webview_launch_created');
      return issued;
    } catch (error) {
      await this.failClaim(Number(session.id), this.failureCode(error));
      if (error instanceof AppException) throw error;
      throw this.databaseUnavailable();
    }
  }

  async activateWebviewSession(code: string): Promise<string> {
    if (!this.isOpaqueCredential(code)) throw this.exchangeFailed();
    const token = this.createCredential();
    const now = new Date();
    try {
      await this.mysql.transaction(async (manager) => {
        const session = await this.sessions.findPendingForUpdate(
          this.digest(code),
          now,
          manager,
        );
        if (!session || !session.userId) {
          this.audit('auth.launch_code_rejected');
          throw this.exchangeFailed();
        }
        session.status = AUTH_SESSION_STATUS.ACTIVE;
        session.sessionTokenHash = this.digest(token);
        session.activatedAt = now;
        session.expiresAt = new Date(
          now.getTime() + WEBVIEW_SESSION_TTL_SECONDS * 1000,
        );
        await this.sessions.save(session, manager);
      });
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw this.databaseUnavailable();
    }
    this.audit('auth.session_created');
    return token;
  }

  async verifySessionToken(token: string): Promise<VerifiedIdentity | null> {
    if (!this.isOpaqueCredential(token)) return null;
    try {
      const session = await this.sessions.findActive(
        this.digest(token),
        new Date(),
        this.mysql.getManager(),
      );
      const user = session?.user;
      if (
        !session?.userId ||
        !session.expiresAt ||
        !user ||
        !user.isActive ||
        user.deletedAt
      ) {
        this.audit('auth.session_rejected');
        return null;
      }
      return { userId: Number(session.userId), expiresAt: session.expiresAt };
    } catch {
      throw this.databaseUnavailable();
    }
  }

  async getMe(
    userId: number,
    cookieToken: string | null,
  ): Promise<AuthSession> {
    if (!Number.isInteger(userId) || !cookieToken) {
      throw this.unauthorized();
    }
    const identity = await this.verifySessionToken(cookieToken);
    if (!identity || identity.userId !== userId) throw this.unauthorized();
    let user: User | null;
    try {
      user = await this.users.findById(userId, this.mysql.getManager());
    } catch {
      throw this.databaseUnavailable();
    }
    if (!user?.isActive || user.deletedAt) throw this.unauthorized();
    return this.buildSession(user, identity.expiresAt);
  }

  async logout(
    cookieToken: string | null,
  ): Promise<{ localLogout: 'completed' }> {
    if (!cookieToken || !this.isOpaqueCredential(cookieToken)) {
      return { localLogout: 'completed' };
    }
    try {
      const revoked = await this.mysql.transaction((manager) =>
        this.sessions.revoke(this.digest(cookieToken), new Date(), manager),
      );
      if (revoked) this.audit('auth.session_revoked');
    } catch {
      throw this.databaseUnavailable();
    }
    return { localLogout: 'completed' };
  }

  /** 供 OAuth 登入共用同一 MySQL session；開發登入仍未註冊於 runtime。 */
  async issueSession(
    userId: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = this.createCredential();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + WEBVIEW_SESSION_TTL_SECONDS * 1000,
    );
    try {
      await this.mysql.transaction((manager) =>
        this.sessions.createActive(
          userId,
          this.digest(`local\0${this.createCredential()}`),
          this.digest(token),
          now,
          expiresAt,
          manager,
        ),
      );
    } catch {
      throw this.databaseUnavailable();
    }
    return { token, expiresAt };
  }

  buildSession(user: User, expiresAt: Date): AuthSession {
    return {
      user: {
        id: Number(user.id),
        empId: user.empid,
        name: user.name,
        departmentName: user.departmentName ?? null,
        titleName: user.titleName ?? null,
        lastLoginAt: user.lastLoginAt ?? null,
      },
      expiresAt,
    };
  }

  private getConfig(config: ConfigService) {
    return {
      iss: config.get<string>('WEBVIEW_JWT_ISSUER')!,
      aud: config.get<string>('WEBVIEW_JWT_AUDIENCE')!,
      key: config.get<string>('WEBVIEW_JWT_PUBLIC_KEY_B64')!,
      launch: config.get<string>('WEBVIEW_LAUNCH_ORIGIN')!,
    };
  }

  private async resolveUserAndIssueCode(
    sessionId: number,
    empid: string,
    staff: StaffLookupDto,
  ): Promise<WebviewLaunchView> {
    const code = this.createCredential();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + WEBVIEW_LAUNCH_TTL_SECONDS * 1000,
    );
    const launchCodeHash = this.digest(code);
    const run = () =>
      this.savePendingLaunch(
        sessionId,
        empid,
        staff,
        launchCodeHash,
        now,
        expiresAt,
      );
    try {
      await run();
    } catch (error) {
      if (!this.isUserCreationRace(error)) throw error;
      await run();
    }
    return {
      launchUrl: `${this.launchOrigin}/api/auth/webview?code=${code}`,
      expiresAt,
    };
  }

  private savePendingLaunch(
    sessionId: number,
    empid: string,
    staff: StaffLookupDto,
    launchCodeHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<void> {
    return this.mysql.transaction(async (manager) => {
      const user = await this.findOrCreateUser(empid, staff, now, manager);
      await this.sessions.markPending(
        sessionId,
        Number(user.id),
        launchCodeHash,
        now,
        expiresAt,
        manager,
      );
    });
  }

  private async findOrCreateUser(
    empid: string,
    staff: StaffLookupDto,
    now: Date,
    manager: EntityManager,
  ): Promise<User> {
    let user = await this.users.findByEmpidForUpdate(empid, manager);
    if (user?.deletedAt || (user && !user.isActive)) {
      throw this.exchangeFailed();
    }
    if (!user) {
      user = this.users.create(
        { empid, name: staff.person_name, isActive: true },
        manager,
      );
    }
    user.name = staff.person_name;
    user.personStatus = staff.person_status_name;
    user.departmentName = staff.department_name ?? undefined;
    user.titleName = staff.title ?? undefined;
    user.lastLoginAt = now;
    return this.users.save(user, manager);
  }

  private verifyLaunchJwt(token: string): LaunchClaims {
    try {
      const parts = token.split('.');
      if (parts.length !== 3 || parts.some((part) => !part)) {
        throw new Error('compact JWS 格式錯誤');
      }
      const [encodedHeader, encodedPayload, encodedSignature] = parts;
      const header = this.parseJsonObject(encodedHeader);
      if (
        Object.keys(header).some((key) => key !== 'alg' && key !== 'typ') ||
        header.alg !== 'RS256' ||
        header.typ !== WEBVIEW_JWT_TYPE
      ) {
        throw new Error('JOSE header 錯誤');
      }
      if (
        !verifySignature(
          'RSA-SHA256',
          Buffer.from(`${encodedHeader}.${encodedPayload}`),
          this.publicKey,
          this.decodeBase64Url(encodedSignature),
        )
      ) {
        throw new Error('簽章錯誤');
      }
      const payload = this.parseJsonObject(encodedPayload);
      this.validateClaims(payload);
      return payload as unknown as LaunchClaims;
    } catch {
      this.audit('auth.webview_launch_rejected');
      throw this.exchangeFailed();
    }
  }

  private validateClaims(payload: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    const numericClaims = ['iat', 'nbf', 'exp'] as const;
    if (
      payload.iss !== this.issuer ||
      payload.aud !== this.audience ||
      typeof payload.sub !== 'string' ||
      !/^[A-Za-z0-9]{1,32}$/.test(payload.sub) ||
      typeof payload.jti !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        payload.jti,
      ) ||
      'empid' in payload ||
      numericClaims.some(
        (claim) =>
          !Number.isInteger(payload[claim]) || (payload[claim] as number) < 0,
      )
    ) {
      throw new Error('claims 錯誤');
    }
    const iat = payload.iat as number;
    const nbf = payload.nbf as number;
    const exp = payload.exp as number;
    if (
      exp <= iat ||
      exp - iat > WEBVIEW_JWT_MAX_TTL_SECONDS ||
      iat > now + WEBVIEW_JWT_CLOCK_TOLERANCE_SECONDS ||
      nbf > now + WEBVIEW_JWT_CLOCK_TOLERANCE_SECONDS ||
      nbf > exp ||
      exp < now - WEBVIEW_JWT_CLOCK_TOLERANCE_SECONDS
    ) {
      throw new Error('時間 claims 錯誤');
    }
    if (
      payload.name !== undefined &&
      (typeof payload.name !== 'string' ||
        payload.name.length < 1 ||
        payload.name.length > 100)
    ) {
      throw new Error('name 錯誤');
    }
  }

  private async failClaim(id: number, failureCode: string): Promise<void> {
    try {
      await this.mysql.transaction((manager) =>
        this.sessions.markFailed(id, failureCode, manager),
      );
    } catch {
      // claim 已寫入且不會釋放；原始失敗語意優先。
    }
  }

  private failureCode(error: unknown): string {
    if (error instanceof AppException) return error.code.slice(0, 50);
    return 'AUTH_EXCHANGE_FAILED';
  }

  private parseJsonObject(encoded: string): Record<string, unknown> {
    const value: unknown = JSON.parse(
      this.decodeBase64Url(encoded).toString('utf8'),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('JWT JSON 格式錯誤');
    }
    return value as Record<string, unknown>;
  }

  private decodeBase64Url(value: string): Buffer {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('base64url 格式錯誤');
    return Buffer.from(value, 'base64url');
  }

  private createCredential(): string {
    return randomBytes(32).toString('base64url');
  }

  private isOpaqueCredential(value: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(value);
  }

  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private isUserCreationRace(error: unknown): boolean {
    if (isDuplicateEntryError(error)) return true;
    const driverError = (error as { driverError?: { code?: string } })
      ?.driverError;
    return driverError?.code === 'ER_LOCK_DEADLOCK';
  }

  private readPublicKey(encoded: string): KeyObject {
    try {
      const pem = Buffer.from(encoded, 'base64').toString('utf8');
      if (pem.includes('PRIVATE KEY')) throw new Error('不得配置私鑰');
      const key = createPublicKey(pem);
      if (key.asymmetricKeyType !== 'rsa') throw new Error('必須是 RSA 公鑰');
      return key;
    } catch {
      throw new Error('WEBVIEW_JWT_PUBLIC_KEY_B64 必須是有效 RSA 公鑰 PEM');
    }
  }

  private audit(event: string): void {
    try {
      this.logger.info({ event, context: AuthService.name, message: event });
    } catch {
      // 稽核 logger 故障不得改變認證交易結果。
    }
  }

  private exchangeFailed(): AppException {
    return new AppException(
      AppErrorCode.AUTH_EXCHANGE_FAILED,
      '無法完成登入交換',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private unauthorized(): AppException {
    return new AppException(
      AppErrorCode.UNAUTHORIZED,
      '登入狀態無效或已到期',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private databaseUnavailable(): AppException {
    return new AppException(
      AppErrorCode.AUTH_DB_UNAVAILABLE,
      '登入服務暫時無法使用',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
