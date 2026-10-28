import { EsignRejectionService } from '../services/esign-rejection.service';
import { RejectionDto } from '../dto/rejection.dto';
import { AppErrors } from '#app/common/errors/app-errors';
import { ApiOkResponse, ApiOperation, ApiProduces } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { allowPdfPreview } from '../helpers/pdf-frame-policy';
import { AppException } from '#app/common/errors/app.exception';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SignatureSubmissionDto } from '../dto/signature-submission.dto';
import { ListSigningTasksQueryDto } from '../dto/document-query.dto';
import { EsignCompletionAccessService } from '../services/esign-completion-access.service';
import { EsignExportHistoryService } from '../services/esign-export-history.service';
import { sendCompletedPdf } from '../helpers/completed-pdf-reply';
import { EsignSigningTaskService } from '../services/esign-signing-task.service';
import {
  EsignSigningService,
  toSignatureResultView,
} from '../services/esign-signing.service';

@Controller('esign/signing-tasks')
export class SigningTasksController {
  constructor(
    private readonly rejection: EsignRejectionService,
    private readonly tasks: EsignSigningTaskService,
    private readonly signing: EsignSigningService,
    private readonly config: ConfigService,
    private readonly completions: EsignCompletionAccessService,
    private readonly exportHistory: EsignExportHistoryService,
  ) {}

  // 員工本人拒簽，沿用文件規則與同次重送。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '拒絕本人簽署任務',
    description:
      '本人 session 授權；文件須允許拒簽。首次回 201，同 requestId 與原因重送回 200；非本人回 404、未登入回 401。',
  })
  @Post(':signerPublicId/rejection')
  async reject(
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
    @Body() body: RejectionDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { repeated, ...result } = await this.rejection.reject(
      signerPublicId,
      { kind: 'internal', userId },
      body,
    );
    reply.status(repeated ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  // 列出目前員工的非草稿簽署任務。
  @ApiOperation({
    summary: '列出本人的簽署任務',
    description:
      '查詢指派給目前員工的非草稿簽署任務，可依狀態篩選。\n\n前端串接參考：/my-signature 列表透過 listSigningTasks() 讀取；/my-signature/[id] 也從此列表找出指定 signerPublicId 的任務。',
  })
  @Get()
  list(
    @CurrentUserId() userId: number,
    @Query() query: ListSigningTasksQueryDto,
  ) {
    return this.tasks.list(userId, query.status);
  }

  // 員工 session 授權；不需要 Email OTP。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '開啟本人簽署任務',
    description:
      '以員工 session 開啟本人任務並記錄開啟事件；非本人或外部指派回 404、未登入回 401。',
  })
  @Post(':signerPublicId')
  open(
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.tasks.open(signerPublicId, userId);
  }

  // 員工 session 授權；不需要 Email OTP。
  @ApiOperation({
    summary: '讀取本人簽署任務的原始 PDF',
    description:
      '以員工 session 讀取本人 PDF；保留期間與完整性驗證。非本人回 404、未登入回 401。',
  })
  @Get(':signerPublicId/source-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async source(
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.tasks.source(signerPublicId, userId);
    if (!file) throw this.notFound();
    allowPdfPreview(reply, this.config.get<string>('AUTH_TRUSTED_ORIGINS'));
    reply
      .type('application/pdf')
      .header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      )
      .send(file.bytes);
  }

  // 員工 session 授權；不需要 Email OTP。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '送出內部員工簽名',
    description:
      '以員工 session 提交本人簽名；首次回 201，同 requestId 重送回 200。非本人回 404、未登入回 401。',
  })
  @Post(':signerPublicId/signatures')
  sign(
    @Param('signerPublicId') signerPublicId: string,
    @Body() body: SignatureSubmissionDto,
    @CurrentUserId() userId: number,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.signing
      .sign(signerPublicId, { kind: 'internal', userId }, body, {
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      })
      .then((result) => {
        reply.status(result.repeated ? HttpStatus.OK : HttpStatus.CREATED);
        return toSignatureResultView(result);
      });
  }

  // 已簽者下載本人副本；完成後不受原簽署期限影響，送出前寫入 pdf 匯出紀錄。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '下載本人已簽署副本',
    description:
      '以員工 session 下載本人已簽署且產製完成的 PDF（200 application/pdf 附件），保留證據與檔案完整性驗證。送出前新增一筆 pdf 匯出紀錄（匯出人與範圍都是本人），寫入失敗回 500 且不送出檔案。缺少或不允許的 Origin 回 403、未產製完成回 409、非本人回 404、未登入回 401，都不記錄。取代已移除的 GET …/completed-file。',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: '已簽署副本 PDF（附件）',
    schema: { type: 'string', format: 'binary' },
  })
  @Post(':signerPublicId/completed-file/downloads')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadCompletedFile(
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const { signer, file } = await this.completions.signerFile(
      signerPublicId,
      userId,
    );
    if (!file)
      throw new AppException(...AppErrors.ESIGN_PERSONAL_COPY_NOT_READY);
    await this.exportHistory.recordPdf(signer, userId);
    sendCompletedPdf(reply, file);
  }

  private notFound(): AppException {
    return new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
  }
}
