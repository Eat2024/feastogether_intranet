import { OrgDepartmentDto } from '#app/infrastructure/http-client/feastogether/types/org-chart.dto';
import {
  ApiOperation,
  ApiOkResponse,
  ApiResponse,
  ApiExtraModels,
  getSchemaPath,
  ApiResponseOptions,
} from '@nestjs/swagger';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { EsignSignerCandidateService } from '../services/esign-signer-candidate.service';

const orgChartErrorResponse = {
  schema: {
    type: 'object',
    required: ['success', 'error', 'timestamp'],
    properties: {
      success: { type: 'boolean', enum: [false] },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
} satisfies ApiResponseOptions;

@Controller('esign/signer-candidates')
export class SignerCandidatesController {
  constructor(private readonly candidates: EsignSignerCandidateService) {}

  @Get('org-chart')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: '查詢正式員工組織架構',
    description: '需有效員工 session',
  })
  @ApiExtraModels(OrgDepartmentDto)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(OrgDepartmentDto) },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    ...orgChartErrorResponse,
    status: 401,
    description: '沿用員工 session 認證錯誤 envelope',
  })
  @ApiResponse({
    ...orgChartErrorResponse,
    status: 502,
    description:
      'ORG_CHART_UPSTREAM_UNAVAILABLE：組織架構來源暫時無法使用；沿用錯誤 envelope',
  })
  @ApiResponse({
    ...orgChartErrorResponse,
    status: 503,
    description:
      'ORG_CHART_UNAVAILABLE：快取或更新協調暫時無法使用；沿用錯誤 envelope',
  })
  getOrgChart(): Promise<OrgDepartmentDto[]> {
    return this.candidates.getOrgChart();
  }

  // 本地查無完整員編時，service 會改向饗賓人 API 查詢並建立帳號
  @ApiOperation({
    summary: '查詢可指定的內部簽署人',
    description:
      '依 q 查詢本地員工；完整八碼員編在本地查無時，向饗賓人 API 查詢符合資格的員工並建立本地帳號。\n\n前端串接參考：/forms/[id]/signers 儲存或發起時，Server Action 以 listSignerCandidates(employeeNo) 將選取的員編轉為後端 userId；目前不是前端即時搜尋下拉選單。',
  })
  @Get()
  async list(@Query('q') query?: string) {
    const users = await this.candidates.list(query);
    return users.map((user) => ({
      id: String(user.id),
      employeeNo: user.empid,
      name: user.name,
      department: user.departmentName ?? null,
      title: user.titleName ?? null,
    }));
  }
}
