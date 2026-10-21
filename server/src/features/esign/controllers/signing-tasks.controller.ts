import { EsignRejectionService } from '../services/esign-rejection.service';
import { RejectionDto } from '../dto/rejection.dto';
import { AppErrors } from '#app/common/errors/app-errors';
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
import { allowPdfPreview } from '../helpers/pdf-frame-policy';
import { AppException } from '#app/common/errors/app.exception';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SignatureSubmissionDto } from '../dto/signature-submission.dto';
import { ListSigningTasksQueryDto } from '../dto/document-query.dto';
import { EsignCompletionAccessService } from '../services/esign-completion-access.service';
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
  ) {}

  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '舊內部拒簽入口（需 Email OTP）',
    description:
      '舊個人操作入口不再提供操作。本人指派回 403 ESIGN_EMAIL_OTP_REQUIRED，請從邀請信完成 OTP 並改用 /api/external-signing-task；非本人回 404、未登入回 401。',
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
    summary: '開啟並確認本人簽署任務（舊入口，需 Email OTP）',
    description:
      '舊個人操作入口不再提供操作。本人指派回 403 ESIGN_EMAIL_OTP_REQUIRED，請從邀請信完成 OTP 並改用 /api/external-signing-task；非本人回 404、未登入回 401。',
  })
  @Post(':signerPublicId')
  open(
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.tasks.open(signerPublicId, userId);
  }

  @ApiOperation({
    summary: '讀取內部簽署任務的原始 PDF（舊入口，需 Email OTP）',
    description:
      '舊個人操作入口不再提供操作。本人指派回 403 ESIGN_EMAIL_OTP_REQUIRED，請從邀請信完成 OTP 並改用 /api/external-signing-task；非本人回 404、未登入回 401。',
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

  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '送出內部員工簽名（舊入口，需 Email OTP）',
    description:
      '舊個人操作入口不再提供操作。本人指派回 403 ESIGN_EMAIL_OTP_REQUIRED，請從邀請信完成 OTP 並改用 /api/external-signing-task；非本人回 404、未登入回 401。',
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
  @ApiOperation({
    summary: '舊內部副本入口（需 Email OTP）',
    description:
      '舊個人操作入口不再提供操作。本人指派回 403 ESIGN_EMAIL_OTP_REQUIRED，請從邀請信完成 OTP 並改用 /api/external-signing-task；非本人回 404、未登入回 401。',
  })
  @Get(':signerPublicId/completed-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async completedFile(
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.completions.signerFile(signerPublicId, userId);
    if (!file)
      throw new AppException(...AppErrors.ESIGN_PERSONAL_COPY_NOT_READY);
    reply
      .type('application/pdf')
      .header(
        'Content-Disposition',
        `attachment; filename="completed.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      )
      .send(file.bytes);
  }

  private notFound(): AppException {
    return new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
  }
}
