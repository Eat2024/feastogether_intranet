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
  EmployeeEmailCheckDto,
  type EmployeeEmailCheckInput,
} from '../dto/employee-email-check.dto';
import { EsignEmployeeEmailService } from '../services/esign-employee-email.service';
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
  ) {}

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

  @ApiOperation({
    summary: '取得建立人的文件詳情',
    description:
      '驗證文件建立人後，回傳文件狀態、簽署人、欄位與來源 PDF 資訊。',
  })
  @Get(':documentId')
  detail(@Param('documentId') id: string, @CurrentUserId() userId: number) {
    return this.queries.creatorDetail(this.id(id), userId);
  }

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
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['success', 'data', 'timestamp'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        timestamp: { type: 'string', format: 'date-time' },
        data: {
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['userId', 'status', 'maskedEmail'],
                properties: {
                  userId: { type: 'string' },
                  status: { type: 'string', enum: ['ready', 'unavailable'] },
                  maskedEmail: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: '需有效員工 session' })
  @ApiResponse({ status: 403, description: 'Origin 驗證失敗' })
  @ApiResponse({ status: 404, description: '文件不存在或非建立人' })
  @ApiResponse({ status: 409, description: '文件不是草稿' })
  @ApiResponse({
    status: 422,
    description:
      'ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE：輸入或帳號無效；不可用帳號列於 error.details.userIds',
  })
  @ApiResponse({
    status: 502,
    description:
      'ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE：來源不可用或回應格式錯誤',
  })
  employeeEmailChecks(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Body(
      new ValidationPipe({
        expectedType: EmployeeEmailCheckDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: () =>
          new AppException(...AppErrors.ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE),
      }),
    )
    body: EmployeeEmailCheckInput,
  ) {
    return this.employeeEmails.checkDraft(this.id(id), userId, body.userIds);
  }

  // 發起簽署
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '發起文件簽署',
    description:
      '在同一交易儲存簽署人、欄位、期間與選項，驗證共用欄位後將草稿轉為簽署中；外部邀請於交易提交後入列。',
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

  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '重新開放已到期文件補簽',
    description:
      '僅建立人可設定新期限及原因；舊期限不符回 409，保留原簽署證據。',
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

  @ApiOperation({
    summary: '取得補簽外部邀請',
    description: '僅建立人主動讀取目前補簽輪的邀請，不寄信、不輪替憑證。',
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

  @ApiOperation({
    summary: '查詢文件簽署歷程',
    description: '回傳建立人可見的文件事件與停止原因。',
  })
  @Get(':documentId/history')
  history(@Param('documentId') id: string, @CurrentUserId() userId: number) {
    return this.queries.history(this.id(id), userId);
  }

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

  @ApiOperation({
    summary: '下載指定簽署人的個人 PDF',
    description: '僅建立人可依簽署人下載已產製完成的個人副本',
  })
  @Get(':documentId/signers/:signerPublicId/completed-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async completedFile(
    @Param('documentId') id: string,
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.completions.creatorFile(
      this.id(id),
      signerPublicId,
      userId,
    );
    if (!file) {
      throw new AppException(...AppErrors.ESIGN_COMPLETED_DOCUMENT_NOT_READY);
    }
    reply
      .type('application/pdf')
      .header(
        'Content-Disposition',
        `attachment; filename="completed.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      )
      .send(file.bytes);
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
