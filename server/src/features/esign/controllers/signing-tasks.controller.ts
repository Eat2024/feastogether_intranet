import { ApiOperation } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  Header,
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
import { resourceNotFound } from '../helpers/esign-errors';
import { allowPdfPreview } from '../helpers/pdf-frame-policy';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SignatureSubmissionDto } from '../dto/signature-submission.dto';
import { ListSigningTasksQueryDto } from '../dto/document-query.dto';
import { EsignSigningTaskService } from '../services/esign-signing-task.service';
import {
  EsignSigningService,
  toSignatureResultView,
} from '../services/esign-signing.service';

@Controller('esign/signing-tasks')
export class SigningTasksController {
  constructor(
    private readonly tasks: EsignSigningTaskService,
    private readonly signing: EsignSigningService,
    private readonly config: ConfigService,
  ) { }

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

  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '開啟並確認本人簽署任務',
    description:
      '驗證任務仍可簽署並記錄開啟事件；因會寫入紀錄，使用 POST。\n\n前端串接參考：/my-signature/[id] 送出簽署時，Server Action 先呼叫 openSigningTask()，再送出 signatures。',
  })
  @Post(':signerPublicId')
  open(
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.tasks.open(signerPublicId, userId);
  }

  @ApiOperation({
    summary: '讀取內部簽署任務的原始 PDF',
    description:
      '驗證目前員工為該任務簽署人後，回傳原始 PDF。\n\n前端串接參考：/my-signature/[id]',
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
    if (!file) throw resourceNotFound();
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
    summary: '送出內部員工簽名',
    description:
      '接收告知同意版本、requestId 與本人各簽名欄位的 PNG；日期欄位由後端填入，並依 requestId 處理重複送出。成功（含重送）回傳該簽章的公開驗證網址 verificationUrl。\n\n前端串接參考：/my-signature/[id] 的 SignFlow 完成告知、閱讀與手寫簽名後，透過 Server Action 的 submitSignatures() 送出。',
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
}
