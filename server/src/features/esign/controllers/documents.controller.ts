import { SignerNoteDto } from '../dto/signer-note.dto';
import { DraftSaveDto, DraftSettingsDto } from '../dto/draft-settings.dto';
import { ReopenDocumentDto, type ReopeningInput } from '../dto/reopening.dto';
import { EsignReopeningService } from '../services/esign-reopening.service';
import {
  ApiBody,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiOkResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { EmployeeEmailCheckDto } from '../dto/employee-email-check.dto';
import { EsignEmployeeEmailService } from '../services/esign-employee-email.service';
import {
  EmployeeEmailCheckResponseDto,
  EmployeeEmailCheckResultDto,
} from '../dto/employee-directory-response.dto';
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
import { ListDocumentsQueryDto } from '../dto/document-query.dto';
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
import { EsignCompletionAccessService } from '../services/esign-completion-access.service';
import { EsignExportHistoryService } from '../services/esign-export-history.service';
import { sendCompletedPdf } from '../helpers/completed-pdf-reply';

@Controller('esign/documents')
export class DocumentsController {
  constructor(
    private readonly drafts: EsignDraftService,
    private readonly signerService: EsignSignerService,
    private readonly fieldService: EsignFieldService,
    private readonly initiations: EsignInitiationService,
    private readonly queries: EsignDocumentQueryService,
    private readonly stoppages: EsignStoppageService,
    private readonly completions: EsignCompletionAccessService,
    private readonly config: ConfigService,
    private readonly reopenings: EsignReopeningService,
    private readonly employeeEmails: EsignEmployeeEmailService,
    private readonly exportHistory: EsignExportHistoryService,
  ) {}

  // 依角色與狀態列出目前員工可見的電子簽文件。
  @ApiOperation({
    summary: '列出電子簽文件',
    description: '依角色與狀態查詢目前員工可見的文件。',
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
    summary: '取得建立人的文件詳情',
    description:
      '驗證文件建立人後，回傳文件狀態、簽署人、欄位與來源 PDF 資訊。',
  })
  @Get(':documentId')
  detail(@Param('documentId') id: string, @CurrentUserId() userId: number) {
    return this.queries.creatorDetail(this.id(id), userId);
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
    return (await this.queries.creatorDetail(documentId, userId)).signers;
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
    return this.queries.creatorDetail(documentId, userId);
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
    return (await this.queries.creatorDetail(documentId, userId)).fields;
  }

  // 預檢草稿所選員工的信箱，只回遮罩結果，不保存或寄信。
  @UseGuards(OriginGuard)
  @Post(':documentId/employee-email-checks')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @ApiCookieAuth()
  @ApiOperation({
    summary: '檢查草稿所選員工的收件信箱',
    description:
      '僅草稿建立人可查詢；只回逐人遮罩結果，不保存信箱、不寄送通知。',
  })
  @ApiBody({ type: EmployeeEmailCheckDto })
  @ApiOkResponse({ type: EmployeeEmailCheckResponseDto })
  @ApiResponse({ status: 400, description: 'INVALID_REQUEST：請求格式錯誤' })
  @ApiResponse({ status: 401, description: '需有效員工 session' })
  @ApiResponse({ status: 403, description: 'Origin 驗證失敗' })
  @ApiResponse({ status: 404, description: '文件不存在或非建立人' })
  @ApiResponse({ status: 409, description: '文件不是草稿' })
  @ApiResponse({
    status: 422,
    description:
      'ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE：ID 超出安全整數範圍或帳號無效；不可用帳號列於 error.details.userIds',
  })
  @ApiResponse({
    status: 502,
    description:
      'ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE：來源不可用或回應格式錯誤',
  })
  employeeEmailChecks(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Body() body: EmployeeEmailCheckDto,
  ): Promise<EmployeeEmailCheckResultDto> {
    return this.employeeEmails.checkDraft(this.id(id), userId, body.userIds);
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
    return this.queries.creatorDetail(documentId, userId);
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

  // 供建立人讀取文件原始 PDF。
  @ApiOperation({
    summary: '讀取建立人的原始 PDF',
    description: '驗證建立人權限後回傳原始 PDF 串流，供預覽使用。',
  })
  @Get(':documentId/source-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async source(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.queries.creatorSource(this.id(id), userId);
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
    return this.queries.creatorDetail(documentId, userId);
  }

  // 供建立人查詢文件歷程。
  @ApiOperation({
    summary: '查詢文件簽署歷程',
    description: '回傳建立人可見的文件事件與停止原因。',
  })
  @Get(':documentId/history')
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

  // 供建立人下載指定簽署人的已簽副本；送出前寫入 pdf 匯出紀錄。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '下載指定簽署人的個人 PDF',
    description:
      '僅建立人可依簽署人下載已產製完成的個人副本，回 200 application/pdf 附件。送出前新增一筆 pdf 匯出紀錄（匯出人為建立人、範圍為簽署人），寫入失敗回 500 且不送出檔案。缺少或不允許的 Origin 回 403、非建立人或簽署人不屬於此文件回 404、副本未產製完成回 409，都不記錄。取代已移除的 GET …/completed-file。',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: '已簽署副本 PDF（附件）',
    schema: { type: 'string', format: 'binary' },
  })
  @Post(':documentId/signers/:signerPublicId/completed-file/downloads')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadCompletedFile(
    @Param('documentId') id: string,
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const { signer, file } = await this.completions.creatorFile(
      this.id(id),
      signerPublicId,
      userId,
    );
    if (!file) {
      throw new AppException(...AppErrors.ESIGN_COMPLETED_DOCUMENT_NOT_READY);
    }
    await this.exportHistory.recordPdf(signer, userId);
    sendCompletedPdf(reply, file);
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
