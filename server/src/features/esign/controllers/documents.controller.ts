import { ApiOperation } from '@nestjs/swagger';
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
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { allowPdfPreview } from '../helpers/pdf-frame-policy';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { ReplaceFieldsDto } from '../dto/field.dto';
import { ListDocumentsQueryDto } from '../dto/document-query.dto';
import { InitiateDocumentDto } from '../dto/initiation.dto';
import { ReplaceSignersDto } from '../dto/signer.dto';
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
  ) { }

  @ApiOperation({
    summary: '列出電子簽文件',
    description:
      '依角色與狀態查詢目前員工可見的文件。',
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
      '以 multipart/form-data 接收 title、file 與可選的 fields（JSON 字串），建立草稿及未指派欄位。',
  })
  @Post()
  async create(
    @CurrentUserId() userId: number,
    @Body('fields') body: CreateDocumentDto,
    @Body('file') file: DocumentUpload['file'],
  ) {
    if (!file) {
      throw new AppException(
        AppErrorCode.INVALID_REQUEST,
        '請上傳 PDF 文件',
        HttpStatus.BAD_REQUEST,
      );
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
    summary: '儲存草稿簽署人名單',
    description:
      '整批取代草稿簽署人並解除既有欄位指派；此 API 不儲存 PDF、欄位位置或發起簽署。',
  })
  @Put(':documentId/draftSave')
  async replaceSigners(
    @Param('documentId') id: string,
    @Body() body: ReplaceSignersDto,
    @CurrentUserId() userId: number,
  ) {
    const documentId = this.id(id);
    await this.signerService.draftSave(documentId, userId, body.signers);
    return (await this.queries.creatorDetail(documentId, userId)).signers;
  }

  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '整批更新草稿欄位與簽署人指派',
    description:
      '驗證原 PDF 完整性、欄位位置與簽署人歸屬後，整批取代欄位；可保留未指派欄位。',
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

  // 發起簽署
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '發起文件簽署',
    description:
      '在同一交易儲存簽署人、欄位、期間與選項，驗證指派後將草稿轉為簽署中；外部邀請於交易提交後入列。',
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

  @ApiOperation({
    summary: '讀取建立人的原始 PDF',
    description:
      '驗證建立人權限後回傳原始 PDF 串流，供預覽使用。',
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
      throw new AppException(
        AppErrorCode.ESIGN_RESOURCE_NOT_FOUND,
        '找不到電子簽資源',
        HttpStatus.NOT_FOUND,
      );
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
    description:
      '回傳建立人可見的文件事件與停止原因。',
  })
  @Get(':documentId/history')
  history(@Param('documentId') id: string, @CurrentUserId() userId: number) {
    return this.queries.history(this.id(id), userId);
  }

  @ApiOperation({
    summary: '下載全員簽署完成的 PDF',
    description:
      '供建立人或已簽署的內部簽署人下載完成文件',
  })
  @Get(':documentId/completed-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async completedFile(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.completions.internalFile(this.id(id), userId);
    if (!file) {
      throw new AppException(
        AppErrorCode.ESIGN_STATE_CONFLICT,
        '完成文件尚未產生',
        HttpStatus.CONFLICT,
      );
    }
    reply
      .type('application/pdf')
      .header('Content-Disposition', 'attachment; filename="completed.pdf"')
      .send(file.bytes);
  }

  private id(value: string): number {
    if (!/^[1-9][0-9]*$/.test(value)) throw this.invalid('文件識別格式錯誤');
    const id = Number(value);
    if (!Number.isSafeInteger(id)) throw this.invalid('文件識別格式錯誤');
    return id;
  }

  private invalid(message: string): AppException {
    return new AppException(
      AppErrorCode.INVALID_REQUEST,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
