import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import {
  ExportHistoryPageDto,
  ExportHistoryQueryDto,
} from '../dto/export-history.dto';
import { sendCompletedPdf } from '../helpers/completed-pdf-reply';
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

  // 從單人 PDF 紀錄重新下載；送出前新增一筆紀錄。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '從 PDF 紀錄重新下載已簽署副本',
    description:
      '需有效員工 session，任何員工都能重新下載任一 pdf 紀錄；外部簽署 session 拒絕。回該簽署人目前的已簽署副本（200 application/pdf 附件，標頭與其他副本下載相同）。送出前新增一筆 pdf 紀錄：文件、簽署人與範圍沿用原紀錄，匯出人為目前使用者；寫入失敗回 500 且不送出檔案。只接受 pdf 紀錄，excel、zip 或不存在回 404；副本無法取得時沿用副本下載的錯誤，都不記錄。',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: '已簽署副本 PDF（附件）',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 401, description: '需有效員工 session' })
  @ApiResponse({
    status: 403,
    description: 'CSRF_ORIGIN_REJECTED：缺少或不允許的 Origin',
  })
  @ApiResponse({
    status: 404,
    description: 'ESIGN_RESOURCE_NOT_FOUND：不是 pdf 紀錄或不存在',
  })
  @ApiResponse({
    status: 409,
    description:
      'ESIGN_STATE_CONFLICT／ESIGN_INTEGRITY_FAILED：副本尚未產生或完整性驗證失敗',
  })
  @ApiResponse({ status: 500, description: '紀錄寫入失敗，不送出檔案' })
  @Post(':id/downloads')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(
    @Param('id') id: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    sendCompletedPdf(reply, await this.history.redownloadPdf(id, userId));
  }
}
