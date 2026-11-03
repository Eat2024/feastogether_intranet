import { createHash } from 'node:crypto';
import { AppErrors } from '#app/common/errors/app-errors';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { FeastogetherConfig } from '#app/infrastructure/http-client/feastogether/feastogether.config';
import { FeastogetherDepartmentService } from '#app/infrastructure/http-client/feastogether/services/feastogether-department.service';
import {
  OrgDepartmentDto,
  parseOrgChart,
} from '#app/infrastructure/http-client/feastogether/types/org-chart.dto';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import type { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import type { EntityManager } from 'typeorm';
import type { SignerCandidateResolutionsDto } from '../dto/resolve-signer-candidates.dto';

/** 員工解析僅查本機主檔；部門樹維持既有人資來源。 */
@Injectable()
export class EsignSignerCandidateService {
  // 不放在 constructor 參數：Nest 會把每個 constructor 參數都當成要注入的 provider
  private readonly manager: EntityManager;

  constructor(
    private readonly users: UserRepository,
    private readonly mysql: MysqlService,
    private readonly departments: FeastogetherDepartmentService,
    private readonly redis: RedisService,
    private readonly feastogetherConfig: FeastogetherConfig,
  ) {
    this.manager = this.mysql.getManager();
  }

  /** 組織瀏覽獨立於員編搜尋／帳號匯入，不寫入本機業務資料。 */
  async getOrgChart(): Promise<OrgDepartmentDto[]> {
    const source = this.feastogetherConfig.baseUrl;
    const namespace = createHash('sha256')
      .update(JSON.stringify([process.env.NODE_ENV ?? 'development', source]))
      .digest('hex');
    const key = `esign:org-chart:v2:${namespace}`;
    const cached = await this.readOrgChart(key);
    if (cached !== null) return cached;

    const data = await this.departments.getOrgChart();
    await this.orgChartCacheOperation(() =>
      this.redis.set(key, { version: 1, data }, 1_800),
    );
    return data;
  }

  private async readOrgChart(key: string): Promise<OrgDepartmentDto[] | null> {
    const raw = await this.orgChartCacheOperation(() => this.redis.get(key));
    if (raw === null) return null;
    try {
      const cached: unknown = JSON.parse(raw);
      if (
        !cached ||
        typeof cached !== 'object' ||
        !('version' in cached) ||
        cached.version !== 1 ||
        !('data' in cached)
      )
        return null;
      return parseOrgChart(cached.data);
    } catch {
      return null;
    }
  }

  private async orgChartCacheOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new AppException(...AppErrors.ORG_CHART_UNAVAILABLE);
    }
  }

  async list(query: string | undefined): Promise<User[]> {
    const q = query?.trim().slice(0, 100);
    return this.users.findActiveCandidates(q, this.manager);
  }

  async resolve(employeeNos: string[]): Promise<SignerCandidateResolutionsDto> {
    const selected = [...new Set(employeeNos)];
    let rows: User[];
    try {
      rows = await this.users.findByEmpids(selected, this.manager);
    } catch {
      throw new AppException(...AppErrors.ESIGN_EMPLOYEE_DIRECTORY_UNAVAILABLE);
    }
    const local = new Map(rows.map((user) => [user.empid, user]));
    const items: SignerCandidateResolutionsDto['items'] = [];
    for (const employeeNo of selected) {
      const existing = local.get(employeeNo);
      const user = existing ? this.activeOrUndefined(existing) : undefined;
      items.push({
        employeeNo,
        userId: user ? String(user.id) : null,
        name: user?.name ?? null,
        department: user?.departmentName ?? null,
        title: user?.titleName ?? null,
        status: user ? 'resolved' : 'unavailable',
      });
    }
    return { items };
  }

  private activeOrUndefined(user: User): User | undefined {
    return user.isActive && !user.deletedAt ? user : undefined;
  }
}
