import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import {
  ExportHistoryPageDto,
  ExportHistoryQueryDto,
} from '../dto/export-history.dto';
import { EsignExportHistoryService } from '../services/esign-export-history.service';

@Controller('esign/history/export')
@ApiCookieAuth('sessionCookie')
export class ExportHistoryController {
  constructor(private readonly history: EsignExportHistoryService) {}

  // 依類型以頁碼查詢所有人的匯出紀錄，附各類型總筆數。
  @Get()
  @ApiOperation({
    summary: '查詢歷史匯出紀錄',
    description:
      '需有效員工 session，可查看所有人的紀錄；外部簽署 session 拒絕。依匯出時間、紀錄流水號由新到舊，以頁碼分頁；items 只含查詢的 type，total 為該類型總筆數，typeTotals 為各類型總筆數（documentId 同時套用）。exportedBy：員工有 employeeNo、email 為 null，外部簽署人相反。conditions 只在 excel、signerPublicId 只在 pdf 出現；zip 另含匯出工作狀態（documentId、status、snapshotAt、expectedCount、processedCount、waitingCount、completedAt、expiresAt、failureCode、files），只計有快照的匯出工作。page 超過最後一頁回空 items。取代已移除的 GET /api/esign/exports。',
  })
  @ApiOkResponse({
    type: ExportHistoryPageDto,
    description: '包在全域回應 envelope 的 data',
  })
  @ApiResponse({
    status: 400,
    description: 'INVALID_REQUEST：type、page、pageSize 或 documentId 不合法',
  })
  @ApiResponse({ status: 401, description: '需有效員工 session' })
  list(@Query() query: ExportHistoryQueryDto): Promise<ExportHistoryPageDto> {
    return this.history.list(query);
  }
}
