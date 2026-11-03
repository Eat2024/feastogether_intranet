import { createHash } from 'node:crypto';
import { AppErrors } from '#app/common/errors/app-errors';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { PortalConfig } from '#app/infrastructure/portal/portal.config';
import { PortalDirectoryService } from '#app/infrastructure/portal/portal-directory.service';
import { OrgDepartmentDto, parseOrgChart } from '../dto/org-chart.dto';
import { buildOrgChart, type OrgChart } from './org-chart.builder';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import type { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import type { EntityManager } from 'typeorm';
import type { SignerCandidateResolutionsDto } from '../dto/resolve-signer-candidates.dto';

/** 員工解析僅查本機主檔；部門樹由 Portal 部門與正式員工組成。 */
@Injectable()
export class EsignSignerCandidateService {
  // 不放在 constructor 參數：Nest 會把每個 constructor 參數都當成要注入的 provider
  private readonly manager: EntityManager;

  constructor(
    private readonly users: UserRepository,
    private readonly mysql: MysqlService,
    private readonly portal: PortalDirectoryService,
    private readonly redis: RedisService,
    private readonly portalConfig: PortalConfig,
    private readonly logger: AppLoggerService,
  ) {
    this.manager = this.mysql.getManager();
  }

  /** 組織瀏覽獨立於員編搜尋／帳號匯入，不寫入本機業務資料。 */
  async getOrgChart(): Promise<OrgDepartmentDto[]> {
    const key = this.orgChartKey();
    const cached = await this.readOrgChart(key);
    if (cached !== null) return cached;

    const data = await this.loadOrgChart();
    await this.orgChartCacheOperation(() =>
      this.redis.set(key, { version: 1, data }, 1_800),
    );
    return data;
  }

  /** 命名空間含 Portal 來源，切換來源後舊快取自然不再命中；設定缺漏視為來源不可用。 */
  private orgChartKey(): string {
    try {
      const namespace = createHash('sha256')
        .update(
          JSON.stringify([
            process.env.NODE_ENV ?? 'development',
            'portal',
            this.portalConfig.host,
            this.portalConfig.port,
            this.portalConfig.database,
          ]),
        )
        .digest('hex');
      return `esign:org-chart:v2:${namespace}`;
    } catch {
      throw new AppException(...AppErrors.ORG_CHART_UPSTREAM_UNAVAILABLE);
    }
  }

  /**
   * Portal 查詢或組樹失敗一律回 502（getOrgChart 因此不寫快取）。不保留原始錯誤：
   * mysql2 的訊息可能含 Portal 主機或帳號，err.sql 可能含查詢值。
   */
  private async loadOrgChart(): Promise<OrgDepartmentDto[]> {
    let chart: OrgChart;
    try {
      const { departments, employees } = await this.portal.listOrgChartSource();
      chart = buildOrgChart(departments, employees);
    } catch {
      throw new AppException(...AppErrors.ORG_CHART_UPSTREAM_UNAVAILABLE);
    }
    if (chart.unmappedEmployees > 0)
      this.logger.warn({
        event: 'esign.org_chart_unmapped_employees',
        context: EsignSignerCandidateService.name,
        metadata: { unmappedEmployees: chart.unmappedEmployees },
      });
    return chart.tree;
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
