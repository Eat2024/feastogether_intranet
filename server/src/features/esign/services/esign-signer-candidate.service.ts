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

/** 完整八碼員編；只有完整員編才向饗賓人 API 查詢，避免逐字搜尋時大量呼叫 */
const FULL_EMPID = /^[0-9]{8}$/;

/**
 * 簽署人候選：先查本地 users；以完整員編查詢且本地沒有時，改向饗賓人 API
 * 查詢試用／正式員工，並比照登入流程建立帳號，讓尚未登入過的同仁也能被指定為簽署人。
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
    const found = await this.users.findActiveCandidates(q, this.manager);
    if (!q || !FULL_EMPID.test(q) || found.some((user) => user.empid === q)) {
      return found;
    }
    const imported = await this.importStaff(q);
    return imported ? [imported, ...found] : found;
  }

  /** 向饗賓人 API 查詢員編並建立本地帳號；查無或不是試用／正式員工時回傳 undefined */
  private async importStaff(empid: string): Promise<User | undefined> {
    let staff: StaffLookupDto;
    try {
      staff = await this.hr.lookupEligibleStaff(empid);
    } catch (error) {
      // lookupEligibleStaff 以 AUTH_EXCHANGE_FAILED 表示查無此人或資格不符；連線失敗等其他錯誤照常拋出
      if (
        error instanceof AppException &&
        error.code === AppErrorCode.AUTH_EXCHANGE_FAILED
      ) {
        return undefined;
      }
      throw error;
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
