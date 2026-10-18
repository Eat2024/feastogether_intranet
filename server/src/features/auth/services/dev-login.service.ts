import { AppErrors } from '#app/common/errors/app-errors';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '#app/common/errors/app.exception';
import {
  DEV_LOGIN_EMPID,
  DEV_LOGIN_NAME,
} from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { isDuplicateEntryError } from '#app/features/auth/repositories/oauth-identity.repository';
import { assertDevModeSafe, isDevLoginAllowed } from '#app/framework/auth-mode';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AuthService, type AuthSession } from './auth.service';

export interface DevLoginResult {
  accessToken: string;
  session: AuthSession;
}

@Injectable()
export class DevLoginService {
  constructor(
    private readonly config: ConfigService,
    private readonly users: UserRepository,
    private readonly authService: AuthService,
    private readonly logger: AppLoggerService,
    private readonly mysql: MysqlService,
  ) {
    assertDevModeSafe(config);
  }

  async login(): Promise<DevLoginResult> {
    if (!isDevLoginAllowed(this.config)) {
      throw new AppException(...AppErrors.NOT_FOUND);
    }
    const user = await this.ensureDevUser();
    const issued = await this.authService.issueSession(Number(user.id));
    this.logger.warn({
      context: DevLoginService.name,
      event: 'auth.dev_login',
      message: '開發者登入已簽發一般員工 session',
      metadata: { userId: user.id },
    });
    return {
      accessToken: issued.token,
      session: this.authService.buildSession(user, issued.expiresAt),
    };
  }

  private async ensureDevUser(): Promise<User> {
    try {
      return await this.saveDevUser();
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      return this.saveDevUser();
    }
  }

  private async saveDevUser(): Promise<User> {
    const manager = this.mysql.getManager();
    const existing = await this.users.findByEmpid(DEV_LOGIN_EMPID, manager);
    if (existing?.deletedAt) {
      await this.users.restore(Number(existing.id), manager);
    }
    const user =
      existing ??
      this.users.create(
        { empid: DEV_LOGIN_EMPID, name: DEV_LOGIN_NAME },
        manager,
      );
    user.isActive = true;
    user.deletedAt = undefined;
    user.lastLoginAt = new Date();
    return this.users.save(user, manager);
  }
}
