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

  @Get()
  list(@CurrentUserId() userId: number, @Query() query: ListDocumentsQueryDto) {
    return this.queries.list(userId, query.role, query.status);
  }

  // 上傳pdf檔
  @UseGuards(OriginGuard)
  @UseInterceptors(DocumentUploadInterceptor)
  @Post()
  async create(
    @CurrentUserId() userId: number,
    @Body('fields') body: CreateDocumentDto,
    @Body('file') file: DocumentUpload['file'],
  ) {
    const document = await this.drafts.create({
      title: body.title,
      creatorUserId: userId,
      ...file!,
    });
    return { id: String(document.id) };
  }

  @Get(':documentId')
  detail(@Param('documentId') id: string, @CurrentUserId() userId: number) {
    return this.queries.creatorDetail(this.id(id), userId);
  }

  @UseGuards(OriginGuard)
  @UseInterceptors(DocumentUploadInterceptor)
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
    });
    return { id: String(documentId) };
  }

  @UseGuards(OriginGuard)
  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('documentId') id: string, @CurrentUserId() userId: number) {
    return this.drafts.delete(this.id(id), userId);
  }

  @UseGuards(OriginGuard)
  @Put(':documentId/signers')
  async replaceSigners(
    @Param('documentId') id: string,
    @Body() body: ReplaceSignersDto,
    @CurrentUserId() userId: number,
  ) {
    const documentId = this.id(id);
    await this.signerService.replace(documentId, userId, body.signers);
    return (await this.queries.creatorDetail(documentId, userId)).signers;
  }

  @UseGuards(OriginGuard)
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
    });
    return this.queries.creatorDetail(documentId, userId);
  }

  @Get(':documentId/source-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async source(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.queries.creatorSource(
      this.id(id),
      userId,
    );
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

  @Get(':documentId/history')
  history(@Param('documentId') id: string, @CurrentUserId() userId: number) {
    return this.queries.history(this.id(id), userId);
  }

  @Get(':documentId/completed-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async completedFile(
    @Param('documentId') id: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.completions.internalFile(
      this.id(id),
      userId,
    );
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
