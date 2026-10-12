import { HttpStatus, Injectable } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { AuthSessionService } from './auth-session.service';

export interface AuthSession {
  user: {
    id: number;
    empId: string;
    name: string;
    departmentName: string | null;
    titleName: string | null;
    lastLoginAt: Date | null;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly sessions: AuthSessionService,
    private readonly users: UserRepository,
    private readonly mysql: MysqlService,
  ) {}

  async getMe(
    userId: number,
    cookieToken: string | null,
  ): Promise<AuthSession> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw this.unauthorized();
    }
    const [user, record] = await Promise.all([
      this.users.findById(userId, this.mysql.getManager()),
      cookieToken ? this.sessions.read(userId, cookieToken) : null,
    ]);
    if (!user?.isActive || user.deletedAt || !record) {
      throw this.unauthorized();
    }
    return this.buildSession(user);
  }

  buildSession(user: User): AuthSession {
    return {
      user: {
        id: Number(user.id),
        empId: user.empid,
        name: user.name,
        departmentName: user.departmentName ?? null,
        titleName: user.titleName ?? null,
        lastLoginAt: user.lastLoginAt ?? null,
      },
    };
  }

  private unauthorized(): AppException {
    return new AppException(
      AppErrorCode.INVALID_CREDENTIALS,
      '使用者不存在或已停用',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
