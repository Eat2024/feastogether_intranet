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
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { CurrentUserId } from '#app/framework/decorators/current-user-id.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SignatureSubmissionDto } from '../dto/signature-submission.dto';
import { ListSigningTasksQueryDto } from '../dto/document-query.dto';
import { EsignSigningTaskService } from '../services/esign-signing-task.service';
import { EsignSigningService } from '../services/esign-signing.service';

@Controller('esign/signing-tasks')
export class SigningTasksController {
  constructor(
    private readonly tasks: EsignSigningTaskService,
    private readonly signing: EsignSigningService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list(
    @CurrentUserId() userId: number,
    @Query() query: ListSigningTasksQueryDto,
  ) {
    return this.tasks.list(userId, query.status);
  }

  @UseGuards(OriginGuard)
  @Post(':signerPublicId')
  open(
    @Param('signerPublicId') signerPublicId: string,
    @CurrentUserId() userId: number,
  ) {
    return this.tasks.open(signerPublicId, userId);
  }

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
  @Post(':signerPublicId/signatures')
  sign(
    @Param('signerPublicId') signerPublicId: string,
    @Body() body: SignatureSubmissionDto,
    @CurrentUserId() userId: number,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.signing
      .sign(
        signerPublicId,
        { kind: 'internal', userId },
        body,
        {
          sourceIp: request.ip,
          userAgent: request.headers['user-agent'],
        },
      )
      .then((result) => {
        reply.status(result.repeated ? HttpStatus.OK : HttpStatus.CREATED);
        return {
          signerPublicId: result.signerPublicId,
          signedAt: result.signedAt.toISOString(),
          documentStatus: result.documentStatus,
        };
      });
  }
  private notFound(): AppException {
    return new AppException(
      AppErrorCode.ESIGN_RESOURCE_NOT_FOUND,
      '找不到電子簽資源',
      HttpStatus.NOT_FOUND,
    );
  }
}
