import { ApiOperation } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import { EsignSignerCandidateService } from '../services/esign-signer-candidate.service';

@Controller('esign/signer-candidates')
export class SignerCandidatesController {
  constructor(private readonly candidates: EsignSignerCandidateService) {}

  // 本地查無完整員編時，service 會改向饗賓人 API 查詢並建立帳號
  @ApiOperation({
    summary: '查詢可指定的內部簽署人',
    description:
      '依 q 查詢本地員工；完整八碼員編在本地查無時，向饗賓人 API 查詢符合資格的員工並建立本地帳號。\n\n前端使用：/forms/[id]/signers 儲存或發起時，Server Action 以 listSignerCandidates(employeeNo) 將選取的員編轉為後端 userId；目前不是前端即時搜尋下拉選單。',
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
