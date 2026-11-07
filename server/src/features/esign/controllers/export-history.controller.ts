import type { Actor } from '#app/features/auth/auth.types';
import { CurrentActor } from '#app/framework/decorators/current-actor.decorator';
import { AllowSuperUser } from '#app/framework/decorators/allow-super-user.decorator';
import { RequirePermissions } from '#app/features/authorization/decorators/require-permissions.decorator';
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
import { ExportDownloadFileNameDto } from '../dto/export.dto';
import { exportFileName } from '../helpers/export-file-name';
import { EsignExportHistoryService } from '../services/esign-export-history.service';

@RequirePermissions('esign.export.read')
@Controller('esign/history/export')
@ApiCookieAuth('sessionCookie')
export class ExportHistoryController {
  constructor(private readonly history: EsignExportHistoryService) {}

  // 依類型以頁碼查詢同部門文件的匯出紀錄，附各類型總筆數。
  @AllowSuperUser()
  @Get()
  @ApiOperation({
    summary: '查詢歷史匯出紀錄',
    description: [
      '**權限**',
      '- 需有效 actor session 與 export.read；預設同部門，export.all 可跨部門',
      '- 外部簽署 session 一律拒絕',
      '',
      '**排序與分頁**',
      '- 依匯出時間、紀錄流水號由新到舊',
      '- 以頁碼分頁；`page` 超過最後一頁時導正到最後有效頁，無結果時回第 1 頁',
      '- `q` 為 trim 後最多 100 字的部分文字，任一文件名稱、文件編號、文件建立人姓名或員編符合即可；不分英文字母大小寫，%／_／! 視為一般文字',
      '',
      '**回應欄位**',
      '- `items`：只含查詢的 `type`',
      '- `total`：該類型的總筆數',
      '- `typeTotals`：各類型總筆數，與 items 套用相同 q、documentId 及可見範圍，不受目前 type 限制',
      '- `exportedBy`：員工有 `employeeNo`、`email` 為 null；外部簽署人相反；Super user 的 employeeNo/email 均為 null，kind 明確區分操作者',
      '- `downloadFileName`：首次提供下載的檔名快照，尚未記錄為 null',
      '- `conditions`：只在 `excel` 出現',
      '- `signerPublicId`：只在 `pdf` 出現',
      '- `zip` 另含匯出工作狀態：`documentId`、`status`、`snapshotAt`、`expectedCount`、`processedCount`、`waitingCount`、`completedAt`、`expiresAt`、`failureCode`、`files`；只計有快照的匯出工作',
      '',
      '**備註**',
      '- 取代已移除的 `GET /api/esign/exports`',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: ExportHistoryPageDto,
    description: '包在全域回應 envelope 的 data',
  })
  @ApiResponse({
    status: 400,
    description:
      'INVALID_REQUEST：type、page、pageSize、documentId 或 q 不合法',
  })
  @ApiResponse({ status: 401, description: '需有效員工 session' })
  list(
    @Query() query: ExportHistoryQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<ExportHistoryPageDto> {
    return this.history.list(query, actor);
  }

  // 新匯出 Excel 前回報並寫入紀錄；歷史重新下載不呼叫此端點。
  @RequirePermissions('esign.export.create')
  @AllowSuperUser()
  @Post()
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '記錄 Excel 匯出',
    description: [
      '**權限**',
      '- 需有效 actor session、export.create 與同源請求；預設同部門，export.all 可跨部門',
      '- 匯出人取自 session，不接受前端傳入',
      '',
      '**Body**',
      '- `type`：只接受 `excel`',
      '- `fileName`：選填，依匯出檔名規則驗證；省略或空白使用文件編號與台北日期組成的預設名稱，回傳 downloadFileName 為實際下載名稱',
      '- `documentId`：須為已發起、未刪除的文件，否則回 404',
      '- `scope`：trim 後 1–2000 字；超過 255 字時存成前 254 字加「…」',
      '- `count`：0 以上整數',
      '- `conditions.statuses`：`pending`／`signed`／`rejected` 的子集；空陣列表示全部',
      '- `conditions.depts`：部門鍵，每個 1–1400 字、最多 500 個；空陣列表示全部',
      '- `conditions.fields`：至少一個，為 `name`、`employeeNo`、`dept`、`title`、`email`、`status`、`signedAt`、`rejectedAt`、`rejectReason` 的子集',
      '- 含未知欄位時回 400',
      '',
      '**回應**',
      '- 201：新紀錄，形狀與查詢的 item 相同；`scope` 為儲存後的值',
      '',
      '**前端串接**',
      '- 僅用於新匯出；歷史重新下載不再次記錄',
      '- Excel 產生成功後記錄匯出，記錄成功後才以回傳的 downloadFileName 下載',
    ].join('\n'),
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
    @CurrentActor() actor: Actor,
    @Body() body: CreateExcelExportRecordDto,
  ): Promise<ExportHistoryItemDto> {
    return this.history.recordExcel(actor, body);
  }

  // 依 Excel 紀錄取得文件目前的資料，供前端重新產生 Excel；唯讀。
  @AllowSuperUser()
  @Get(':id/document')
  @ApiOperation({
    summary: '取得 Excel 重新下載資料',
    description: [
      '**權限**',
      '- 需有效 actor session 與 export.read；預設同部門，export.all 可跨部門，不限原匯出人',
      '- 外部簽署 session 一律拒絕',
      '',
      '**規則**',
      '- 只接受 `excel` 紀錄；其他類型、紀錄不存在或文件已刪除回 404',
      '- 唯讀，不新增紀錄',
      '',
      '**回應欄位**（只含產生 Excel 需要的欄位，名稱與文件詳情相同）',
      '- 文件：`id`、`title`、`docNumber`、`signStartAt`、`signEndAt`、`originalSignEndAt`、`isReopened`、`createdBy`',
      '- `signers`：`type`、`name`、`employeeNo`、`department`、`title`、`email`、`status`、`signedAt`、`rejectedAt`、`rejectReason`',
      '- 不含簽署人 `publicId`、管理備註、通知結果與驗證網址',
      '',
      '**前端串接**',
      '1. 依原紀錄的 `conditions` 篩選簽署人',
      '2. 直接產生並下載 Excel，不再呼叫記錄 API',
    ].join('\n'),
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
  excelDocument(
    @Param('id') id: string,
    @CurrentActor() actor: Actor,
  ): Promise<ExcelExportDocumentDto> {
    return this.history.excelDocument(id, actor);
  }

  // 從單人 PDF 紀錄重新下載；不新增或改寫匯出歷史。
  @ApiOperation({
    summary: '從 PDF 紀錄重新下載已簽署副本',
    description: [
      '**權限**',
      '- 需有效員工 session、export.read 能力與同源請求；僅該內部指派的本人可重新下載 `pdf` 紀錄，不依賴部門資格',
      '- 外部簽署 session 一律拒絕',
      '',
      '**回應**',
      '- 200 `application/pdf` 附件：該簽署人目前的已簽署副本，標頭與其他副本下載相同',
      '',
      '**Body（可省略）**',
      '- `fileName`：本次下載名稱；省略或空白沿用預設，依匯出命名規則驗證並補上 .pdf，不持久保存',
      '- 不合法名稱或未知欄位回 400',
      '',
      '**紀錄**',
      '- 沿用原紀錄，不新增或改寫匯出歷史；重複請求不產生業務寫入',
      '',
      '**錯誤**',
      '- 只接受 `pdf` 紀錄；`excel`、`zip` 或不存在回 404',
      '- 副本無法取得時沿用副本下載的錯誤（409），不新增紀錄',
    ].join('\n'),
  })
  @ApiParam({ name: 'id', description: 'pdf 紀錄 UUID' })
  @ApiResponse({ status: 401, description: '需有效員工 session' })
  @ApiResponse({
    status: 403,
    description: 'CSRF_ORIGIN_REJECTED：缺少或不允許的 Origin',
  })
  @ApiResponse({
    status: 404,
    description: 'ESIGN_RESOURCE_NOT_FOUND：不是 pdf 紀錄、不存在或非本人指派',
  })
  @ApiResponse({
    status: 409,
    description:
      'ESIGN_STATE_CONFLICT／ESIGN_INTEGRITY_FAILED：副本尚未產生或完整性驗證失敗',
  })
  @Post(':id/downloads')
  @CompletedPdfDownload()
  async download(
    @Param('id') id: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
    @Body() body: ExportDownloadFileNameDto,
  ): Promise<void> {
    const fileName = exportFileName(body?.fileName, 'pdf');
    const file = await this.history.redownloadPdf(id, userId);
    sendCompletedPdf(reply, { ...file, fileName: fileName ?? file.fileName });
  }
}
