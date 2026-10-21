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
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import type { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import type { StaffLookupDto } from '#app/infrastructure/http-client/feastogether/types/staff-lookup.dto';
import type { EntityManager } from 'typeorm';
import type { SignerCandidateResolutionsDto } from '../dto/resolve-signer-candidates.dto';

/** 既有 HR lookup 支援的完整員編範圍。 */
const LOOKUP_EMPID = /^[A-Za-z0-9]{5,8}$/;

/**
 * 搜尋只查本機；明確解析已選員工時才查資格來源並建立必要帳號。
 */
@Injectable()
export class EsignSignerCandidateService {
  // 不放在 constructor 參數：Nest 會把每個 constructor 參數都當成要注入的 provider
  private readonly manager: EntityManager;

  constructor(
    private readonly users: UserRepository,
    private readonly mysql: MysqlService,
    private readonly hr: FeastogetherHrService,
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
    const key = `esign:org-chart:v1:${namespace}`;
    const cached = await this.readOrgChart(key);
    if (cached !== null) return cached;

    const data = await this.departments.getOrgChart();
    await this.orgChartCacheOperation(() =>
      this.redis.set(key, { version: 1, data }, 7_200),
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
    const local = new Map(
      (await this.users.findByEmpids(selected, this.manager)).map((user) => [
        user.empid,
        user,
      ]),
    );
    const items: SignerCandidateResolutionsDto['items'] = [];
    for (const employeeNo of selected) {
      const existing = local.get(employeeNo);
      const user = existing
        ? this.activeOrUndefined(existing)
        : LOOKUP_EMPID.test(employeeNo)
          ? await this.importStaff(employeeNo)
          : undefined;
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

  /** 向饗賓人 API 查詢員編並建立本地帳號；查無或不是試用／正式員工時回傳 undefined */
  private async importStaff(empid: string): Promise<User | undefined> {
    let staff: StaffLookupDto;
    try {
      staff = await this.hr.lookupEligibleStaff(empid);
    } catch (error) {
      // 查無或資格不符逐人 unavailable；來源失敗不轉成登入錯誤。
      if (
        error instanceof AppException &&
        error.code === AppErrorCode.AUTH_EXCHANGE_FAILED
      ) {
        return undefined;
      }
      throw new AppException(...AppErrors.ESIGN_EMPLOYEE_DIRECTORY_UNAVAILABLE);
    }

    try {
      return await this.mysql.transaction(async (manager) => {
        const existing = await this.users.findByEmpidForUpdate(empid, manager);
        // 已停用或刪除的帳號不在此重新啟用（與登入流程一致）
        if (existing) return this.activeOrUndefined(existing);
        return this.users.save(
          this.users.create(
            {
              empid,
              name: staff.person_name,
              isActive: true,
              personStatus: staff.person_status_name,
              departmentName: staff.department_name ?? undefined,
              titleName: staff.title ?? undefined,
            },
            manager,
          ),
          manager,
        );
      });
    } catch (error) {
      // 同一員編同時被匯入（empid 唯一）時，改讀已建立的帳號
      const existing = await this.users.findByEmpid(empid, this.manager);
      if (existing) return this.activeOrUndefined(existing);
      throw error;
    }
  }

  private activeOrUndefined(user: User): User | undefined {
    return user.isActive && !user.deletedAt ? user : undefined;
  }
}
