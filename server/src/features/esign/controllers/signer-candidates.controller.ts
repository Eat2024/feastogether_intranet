import { OrgDepartmentDto } from '#app/infrastructure/http-client/feastogether/types/org-chart.dto';
import { ApiOperation, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import {
  ResolveSignerCandidatesDto,
  SignerCandidateResolutionsDto,
} from '../dto/resolve-signer-candidates.dto';
import { EsignSignerCandidateService } from '../services/esign-signer-candidate.service';
import {
  EmployeeDirectoryErrorResponseDto,
  SignerCandidateOrgChartResponseDto,
  SignerCandidateResolutionsResponseDto,
} from '../dto/employee-directory-response.dto';

@Controller('esign/signer-candidates')
export class SignerCandidatesController {
  constructor(private readonly candidates: EsignSignerCandidateService) {}

  @Get('org-chart')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: '查詢正式員工組織架構',
    description: '需有效員工 session',
  })
  @ApiOkResponse({ type: SignerCandidateOrgChartResponseDto })
  @ApiResponse({
    type: EmployeeDirectoryErrorResponseDto,
    status: 401,
    description: '沿用員工 session 認證錯誤 envelope',
  })
  @ApiResponse({
    type: EmployeeDirectoryErrorResponseDto,
    status: 502,
    description:
      'ORG_CHART_UPSTREAM_UNAVAILABLE：組織架構來源暫時無法使用；沿用錯誤 envelope',
  })
  @ApiResponse({
    type: EmployeeDirectoryErrorResponseDto,
    status: 503,
    description:
      'ORG_CHART_UNAVAILABLE：快取或更新協調暫時無法使用；沿用錯誤 envelope',
  })
  getOrgChart(): Promise<OrgDepartmentDto[]> {
    return this.candidates.getOrgChart();
  }

  @Post('resolutions')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: '解析已選員工為本機簽署人',
    description:
      '需有效員工 session 與 Origin 檢查；僅解析明確選取的完整員編，不回傳信箱。',
  })
  @ApiOkResponse({ type: SignerCandidateResolutionsResponseDto })
  @ApiResponse({
    type: EmployeeDirectoryErrorResponseDto,
    status: 400,
    description: '請求格式錯誤',
  })
  @ApiResponse({
    type: EmployeeDirectoryErrorResponseDto,
    status: 401,
    description: '員工 session 無效',
  })
  @ApiResponse({
    type: EmployeeDirectoryErrorResponseDto,
    status: 403,
    description: 'Origin 檢查失敗',
  })
  @ApiResponse({
    type: EmployeeDirectoryErrorResponseDto,
    status: 502,
    description:
      'ESIGN_EMPLOYEE_DIRECTORY_UNAVAILABLE：員工資格來源暫時無法使用',
  })
  resolve(
    @Body() input: ResolveSignerCandidatesDto,
  ): Promise<SignerCandidateResolutionsDto> {
    return this.candidates.resolve(input.employeeNos);
  }

  @ApiOperation({
    summary: '查詢可指定的內部簽署人',
    description:
      '依 q 查詢本機有效員工，不呼叫上游或建立帳號；未建帳的已選員工請使用 POST resolutions。',
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
