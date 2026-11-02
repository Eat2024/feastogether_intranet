import { EsignHistoryItemDto } from '../dto/esign-common.dto';
import { SignerNoteDto } from '../dto/signer-note.dto';
import { DraftSaveDto, DraftSettingsDto } from '../dto/draft-settings.dto';
import { ReopenDocumentDto, type ReopeningInput } from '../dto/reopening.dto';
import { EsignReopeningService } from '../services/esign-reopening.service';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiOkResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { allowPdfPreview } from '../helpers/pdf-frame-policy';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { ReplaceFieldsDto } from '../dto/field.dto';
import {
  ListDocumentsQueryDto,
  ReadDocumentQueryDto,
} from '../dto/document-query.dto';
import { InitiateDocumentDto } from '../dto/initiation.dto';
import {
  CreateDocumentDto,
  UpdateDocumentDto,
} from '../dto/document-upload.dto';
import { StopDocumentDto } from '../dto/stoppage.dto';
import {
  DocumentUploadInterceptor,
  type DocumentUpload,
} from '../interceptors/document-upload.interceptor';
import { EsignDocumentQueryService } from '../services/esign-document-query.service';
import { EsignDraftService } from '../services/esign-draft.service';
import { EsignFieldService } from '../services/esign-field.service';
import { EsignInitiationService } from '../services/esign-initiation.service';
import { EsignSignerService } from '../services/esign-signer.service';
import { EsignStoppageService } from '../services/esign-stoppage.service';
import { EsignExportHistoryService } from '../services/esign-export-history.service';
import {
  CompletedPdfDownload,
  sendCompletedPdf,
} from '../helpers/completed-pdf-reply';

@Controller('esign/documents')
export class DocumentsController {
  constructor(
    private readonly drafts: EsignDraftService,
    private readonly signerService: EsignSignerService,
    private readonly fieldService: EsignFieldService,
    private readonly initiations: EsignInitiationService,
    private readonly queries: EsignDocumentQueryService,
    private readonly stoppages: EsignStoppageService,
    private readonly config: ConfigService,
    private readonly reopenings: EsignReopeningService,
    private readonly exportHistory: EsignExportHistoryService,
  ) {}

  // 依角色與狀態列出目前員工可見的電子簽文件。
  @ApiOperation({
    summary: '列出電子簽文件',
    description:
      'dep 為同部門；created／assigned 為本人範圍，未帶 role 合併本人範圍。不接受呼叫者指定部門。',
  })
  @Get()
  list(@CurrentUserId() userId: number, @Query() query: ListDocumentsQueryDto) {
    return this.queries.list(userId, query.role, query.status);
  }

  // 上傳pdf檔，可一併帶入草稿欄位
  @UseGuards(OriginGuard)
  @UseInterceptors(DocumentUploadInterceptor)
  @ApiOperation({
    summary: '上傳 PDF 並建立草稿',
    description:
      '以 multipart/form-data 接收 title、file 與可選的 fields（JSON 字串），建立草稿及共用欄位。',
  })
  @Post()
  async create(
    @CurrentUserId() userId: number,
    @Body('fields') body: CreateDocumentDto,
    @Body('file') file: DocumentUpload['file'],
  ) {
    if (!file) {
      throw new AppException(...AppErrors.ESIGN_PDF_REQUIRED);
    }
    const document = await this.drafts.create({
      title: body.title,
      creatorUserId: userId,
      fields: body.fields,
      ...file,
    });
    return { id: String(document.id) };
  }

  // 取得建立人可見的文件明細與簽署狀態。
  @ApiOperation({
    summary: '取得文件詳情或同部門匯出資料',
    description:
      '建立人回傳管理詳情；同部門非建立人回傳裁切的唯讀詳情。view=export 另驗證同部門後只提供 Excel 匯出資料，不新增紀錄。',
  })
  @Get(':documentId')
  detail(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Query() query: ReadDocumentQueryDto,
  ) {
    return query.view === 'export'
      ? this.queries.exportDocument(this.id(id), userId)
      : this.queries.detail(this.id(id), userId);
  }

  // 更新草稿內容，並在提供新 PDF 時替換原檔。
  @UseGuards(OriginGuard)
  @UseInterceptors(DocumentUploadInterceptor)
  @ApiOperation({
    summary: '更新草稿名稱、PDF 或欄位',
    description:
      '僅建立人可修改草稿。以 multipart/form-data 接收更新內容；替換 PDF 會清除舊欄位，有傳 fields 時依新 PDF 重新建立，未換 PDF 時則整批取代傳入的欄位。',
  })
  @Patch(':documentId')
  async update(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Body('fields') body: UpdateDocumentDto,
    @Body('file') file: DocumentUpload['file'],
  ) {
    const documentId = this.id(id);
    await this.drafts.update(documentId, userId, {
      title: body.title,
      file,
      fields: body.fields,
    });
    return { id: String(documentId) };
  }

  // 由建立人軟刪除尚未發起的草稿。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '刪除草稿',
    description:
      '僅建立人可刪除尚未發起的文件，以軟刪除保留資料並記錄稽核事件。',
  })
  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('documentId') id: string, @CurrentUserId() userId: number) {
    return this.drafts.delete(this.id(id), userId);
  }

  // 儲存草稿簽署人名單、期間與選項，不發起簽署。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '儲存草稿簽署人名單、期間與選項',
    description:
      '相容既有回應形狀；可在同一交易整批取代簽署人並保存起迄時間、浮水印與允許拒簽。此 API 不儲存 PDF、欄位位置或發起簽署。',
  })
  @Put(':documentId/draftSave')
  async replaceSigners(
    @Param('documentId') id: string,
    @Body() body: DraftSaveDto,
    @CurrentUserId() userId: number,
  ) {
    const documentId = this.id(id);
    await this.signerService.draftSave(documentId, userId, body);
    return (await this.queries.detail(documentId, userId)).signers;
  }

  // 完整暫存草稿的簽署人名單、期間與選項。
  @UseGuards(OriginGuard)
  @ApiOperation({ summary: '完整暫存草稿名單、期間與選項' })
  @Patch(':documentId/draft-settings')
  async saveDraftSettings(
    @Param('documentId') id: string,
    @Body() body: DraftSettingsDto,
    @CurrentUserId() userId: number,
  ) {
    const documentId = this.id(id);
    await this.signerService.saveDraftSettings(documentId, userId, body);
    return this.queries.detail(documentId, userId);
  }

  // 整批取代草稿的共用簽署欄位。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '整批更新草稿共用欄位',
    description: '驗證原 PDF 完整性與欄位位置後，整批取代共用欄位。',
  })
  @Put(':documentId/fields')
  async replaceFields(
    @Param('documentId') id: string,
    @Body() body: ReplaceFieldsDto,
    @CurrentUserId() userId: number,
  ) {
    const documentId = this.id(id);
    await this.fieldService.replace(documentId, userId, body.fields);
    const detail = await this.queries.detail(documentId, userId);
    if (!detail.isCreator)
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    return detail.fields;
  }

  // 發起簽署
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '發起文件簽署',
    description:
      '在交易外批次核對員工信箱；同一交易再次驗證帳號並固定地址、儲存名單、欄位與期間。內部以共用入口群寄，無有效信箱保留指派並記錄略過通知；外部逐人建立邀請。來源失敗 502、員工身分異動 409，整份保持草稿。',
  })
  @ApiResponse({
    status: 422,
    description: '所選員工身分無效或無法解析',
  })
  @ApiResponse({
    status: 502,
    description: 'ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE',
  })
  @ApiResponse({
    status: 409,
    description: '非草稿或 ESIGN_EMPLOYEE_IDENTITY_CHANGED',
  })
  @Post(':documentId/initiations')
  async initiate(
    @Param('documentId') id: string,
    @Body() body: InitiateDocumentDto,
    @CurrentUserId() userId: number,
  ) {
    const documentId = this.id(id);
    await this.initiations.initiate({
      documentId,
      creatorUserId: userId,
      signers: body.signers,
      fields: body.fields,
      signStartAt: new Date(body.signStartAt),
      signEndAt: new Date(body.signEndAt),
      watermark: body.watermark,
      allowReject: body.allowReject,
    });
    return this.queries.detail(documentId, userId);
  }

  // 由建立人重新開放到期文件補簽，並寄出待簽者的新邀請。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '重新開放已到期文件補簽',
    description:
      '僅建立人可設定新期限及原因；舊期限不符或任一外部待簽者缺固定信箱／原邀請回 409。內部無信箱仍可補簽；成功後有信箱者依內部群寄、外部逐人方式通知，保留已簽及已拒證據。',
  })
  @ApiBody({ type: ReopenDocumentDto })
  @Post(':documentId/reopenings')
  reopen(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Body(
      new ValidationPipe({
        expectedType: ReopenDocumentDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: () =>
          new AppException(...AppErrors.ESIGN_REOPEN_INPUT_INVALID),
      }),
    )
    body: ReopeningInput,
  ) {
    return this.reopenings.reopen(this.id(id), userId, body);
  }

  // 取得目前補簽輪仍保留密文的邀請，不寄信或輪替憑證。
  @ApiOperation({
    summary: '取得仍可取用的補簽邀請',
    description:
      '僅建立人讀取內外部待簽者尚存密文的邀請，不寄信、不輪替憑證。成功寄送後省略該項，全數送達回空陣列；請以通知紀錄確認進度。',
  })
  @Get(':documentId/reopening-invitations')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  reopeningInvitations(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
  ) {
    return this.queries.reopeningInvitations(this.id(id), userId);
  }

  // 供建立人或同部門讀取文件原始 PDF。
  @ApiOperation({
    summary: '讀取授權文件的原始 PDF',
    description: '驗證建立人或同部門唯讀權限後回傳原始 PDF 串流，供預覽使用。',
  })
  @Get(':documentId/source-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async source(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.queries.source(this.id(id), userId);
    if (!file) {
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    }
    allowPdfPreview(reply, this.config.get<string>('AUTH_TRUSTED_ORIGINS'));
    reply
      .type('application/pdf')
      .header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      )
      .send(file.bytes);
  }

  // 由建立人永久停止文件簽署。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '停止文件簽署',
    description:
      '由建立人提供原因停止簽署，回傳更新後的文件詳情並保留停止紀錄。',
  })
  @Post(':documentId/stoppages')
  async stop(
    @Param('documentId') id: string,
    @Body() body: StopDocumentDto,
    @CurrentUserId() userId: number,
  ) {
    const documentId = this.id(id);
    await this.stoppages.stopByCreator(documentId, userId, body.reason);
    return this.queries.detail(documentId, userId);
  }

  // 回傳目前員工可見的歷程與中文說明。
  @ApiOperation({
    summary: '查詢文件簽署歷程',
    description:
      '建立人取得管理事件；同部門取得文件層級事件，保留本人簽署事件可見規則。',
  })
  @Get(':documentId/history')
  @ApiOperation({
    summary: '查詢可見的簽署歷程',
    description:
      '每筆包含原事件 type 與繁體中文 label；未知事件使用中性中文說明。保留既有歷程授權與補簽資訊裁切，不改寫稽核資料。',
  })
  @ApiOkResponse({
    type: [EsignHistoryItemDto],
    description: '全域回應 envelope 的 data 為歷程陣列',
  })
  history(@Param('documentId') id: string, @CurrentUserId() userId: number) {
    return this.queries.history(this.id(id), userId);
  }

  // 由建立人儲存指定簽署人的管理備註。
  @UseGuards(OriginGuard)
  @ApiOperation({ summary: '儲存或清除簽署人的管理備註' })
  @Patch(':documentId/signers/:signerPublicId/note')
  saveSignerNote(
    @Param('documentId') id: string,
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
    @Body() body: SignerNoteDto,
  ) {
    return this.signerService.saveNote(
      this.id(id),
      signerPublicId,
      userId,
      body.note,
    );
  }

  // 供同部門員工下載指定簽署人的已簽副本；送出前寫入 pdf 匯出紀錄。
  @ApiOperation({
    summary: '下載指定簽署人的個人 PDF',
    description:
      '同部門員工可依簽署人下載已產製完成的個人副本，回 200 application/pdf 附件。送出前新增一筆 pdf 匯出紀錄（匯出人為目前員工、範圍為簽署人），寫入失敗回 500 且不送出檔案。缺少或不允許的 Origin 回 403、跨部門或簽署人不屬於此文件回 404、副本未產製完成回 409，都不記錄。取代已移除的 GET …/completed-file。',
  })
  @Post(':documentId/signers/:signerPublicId/completed-file/downloads')
  @CompletedPdfDownload()
  async downloadCompletedFile(
    @Param('documentId') id: string,
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    sendCompletedPdf(
      reply,
      await this.exportHistory.downloadDepartmentCopy(
        this.id(id),
        signerPublicId,
        userId,
      ),
    );
  }

  private id(value: string): number {
    if (!/^[1-9][0-9]*$/.test(value))
      throw new AppException(...AppErrors.ESIGN_DOCUMENT_ID_INVALID);
    const id = Number(value);
    if (!Number.isSafeInteger(id))
      throw new AppException(...AppErrors.ESIGN_DOCUMENT_ID_INVALID);
    return id;
  }
}
