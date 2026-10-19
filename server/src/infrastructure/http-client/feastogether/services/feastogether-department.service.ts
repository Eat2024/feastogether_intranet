import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { parseOrgChart, OrgDepartmentDto } from '../types/org-chart.dto';
import { Injectable } from '@nestjs/common';
import { FeastogetherClient } from '../feastogether.client';
import { mapFeastogetherUpstreamError } from '../feastogether-error.util';
import {
  DepartmentItem,
  SearchDepartmentGroup,
} from '../types/department.types';

const PATHS = {
  allDepartment: '/api/v1/staff/all_department',
  allSearchDepartment: '/api/v1/staff/all_search_department',
} as const;

/** 饗賓部門主檔（noauth，僅 X-API-KEY）。顯示用，不參與授權（FR-105）。 */
@Injectable()
export class FeastogetherDepartmentService {
  constructor(private readonly client: FeastogetherClient) { }

  /** 正式員工組織樹；使用平台 API Key，不傳員工 token。 */
  async getOrgChart(): Promise<OrgDepartmentDto[]> {
    try {
      const data = await this.client.get<unknown>('/api/v1/hr/org_chart', {
        timeoutMs: 10_000,
      });
      const tree = parseOrgChart(data);
      return tree;
    } catch {
      throw new AppException(...AppErrors.ORG_CHART_UPSTREAM_UNAVAILABLE);
    }
  }

  /** 所有部門（公告選擇用）。 */
  async getAllDepartment(): Promise<DepartmentItem[]> {
    try {
      return await this.client.get<DepartmentItem[]>(PATHS.allDepartment);
    } catch (error) {
      throw mapFeastogetherUpstreamError(error);
    }
  }

  /** 搜尋部門下拉（含總部與各營業點）。 */
  async getAllSearchDepartment(): Promise<SearchDepartmentGroup[]> {
    try {
      return await this.client.get<SearchDepartmentGroup[]>(
        PATHS.allSearchDepartment,
      );
    } catch (error) {
      throw mapFeastogetherUpstreamError(error);
    }
  }
}
