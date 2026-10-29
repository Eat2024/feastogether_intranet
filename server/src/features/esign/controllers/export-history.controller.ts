import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import {
  CreateExcelExportRecordDto,
  ExcelExportDocumentDto,
  ExportHistoryItemDto,
  ExportHistoryPageDto,
  ExportHistoryQueryDto,
} from '../dto/export-history.dto';
import {
  CompletedPdfDownload,
  sendCompletedPdf,
} from '../helpers/completed-pdf-reply';
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

  // 前端下載 Excel 前回報匯出，由後端寫入紀錄；首次匯出與重新下載共用。
  @Post()
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '記錄 Excel 匯出',
    description:
      '需有效員工 session 與同源請求；不限建立人。type 只接受 excel；documentId 須為已發起且未刪除的文件，否則 404；scope trim 後 1–2000 字，超過 255 字時存成前 254 字加「…」，回應為儲存的值；count 為 0 以上整數；conditions.statuses 為 pending／signed／rejected 的子集、conditions.depts 為部門鍵（每個 1–1000 字、最多 500 個），兩者空陣列表示全部；conditions.fields 至少一個，為 name、employeeNo、dept、title、email、status、signedAt、rejectedAt、rejectReason 的子集。匯出人取自 session，不接受前端傳入；未知欄位回 400。成功回新紀錄，形狀與查詢的 item 相同。前端在記錄成功後才產生並下載 Excel。',
  })
  @ApiCreatedResponse({
    type: ExportHistoryItemDto,
    description: '新紀錄，包在全域回應 envelope 的 data',
  })
  @ApiResponse({
    status: 400,
    description: 'INVALID_REQUEST：欄位不合法或含未知欄位',
  })
  @ApiResponse({ status: 401, description: '需有效員工 session' })
  @ApiResponse({
    status: 403,
    description: 'CSRF_ORIGIN_REJECTED：缺少或不允許的 Origin',
  })
  @ApiResponse({
    status: 404,
    description: 'ESIGN_RESOURCE_NOT_FOUND：文件不存在、已刪除或仍是草稿',
  })
  record(
    @CurrentUserId() userId: number,
    @Body() body: CreateExcelExportRecordDto,
  ): Promise<ExportHistoryItemDto> {
    return this.history.recordExcel(userId, body);
  }

  // 依 Excel 紀錄取得文件目前的資料，供前端重新產生 Excel；唯讀。
  @Get(':id/document')
  @ApiOperation({
    summary: '取得 Excel 重新下載資料',
    description:
      '需有效員工 session，任何員工可用，不限建立人或原匯出人；外部簽署 session 拒絕。只接受 excel 紀錄，其他類型、紀錄不存在或文件已刪除回 404。唯讀，不新增紀錄。回文件目前的資料，只含產生 Excel 需要的欄位（id、title、docNumber、signStartAt、signEndAt、originalSignEndAt、isReopened、createdBy、signers），欄位名稱與文件詳情相同；signers 只含 type、name、employeeNo、department、title、email、status、signedAt、rejectedAt、rejectReason，不含簽署人 publicId、管理備註、通知結果與驗證網址。前端依原紀錄的 conditions 篩選，先以 POST /api/esign/history/export 記錄，成功後才產生並下載 Excel。',
  })
  @ApiParam({ name: 'id', description: 'excel 紀錄 UUID' })
  @ApiOkResponse({
    type: ExcelExportDocumentDto,
    description: '包在全域回應 envelope 的 data',
  })
  @ApiResponse({ status: 401, description: '需有效員工 session' })
  @ApiResponse({
    status: 404,
    description:
      'ESIGN_RESOURCE_NOT_FOUND：紀錄不存在、不是 excel 紀錄或文件已刪除',
  })
  excelDocument(@Param('id') id: string): Promise<ExcelExportDocumentDto> {
    return this.history.excelDocument(id);
  }

  // 從單人 PDF 紀錄重新下載；送出前新增一筆紀錄。
  @ApiOperation({
    summary: '從 PDF 紀錄重新下載已簽署副本',
    description:
      '需有效員工 session，任何員工都能重新下載任一 pdf 紀錄；外部簽署 session 拒絕。回該簽署人目前的已簽署副本（200 application/pdf 附件，標頭與其他副本下載相同）。送出前新增一筆 pdf 紀錄：文件、簽署人與範圍沿用原紀錄，匯出人為目前使用者；寫入失敗回 500 且不送出檔案。只接受 pdf 紀錄，excel、zip 或不存在回 404；副本無法取得時沿用副本下載的錯誤，都不記錄。',
  })
  @ApiParam({ name: 'id', description: 'pdf 紀錄 UUID' })
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
  @CompletedPdfDownload()
  async download(
    @Param('id') id: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    sendCompletedPdf(reply, await this.history.redownloadPdf(id, userId));
  }
}
