import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { cookieTokenFromMap } from '#app/common/http/cookie-token.helper';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { Public } from '#app/framework/decorators/public.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SignatureSubmissionDto } from '../dto/signature-submission.dto';
import {
  clearExternalAccessCookie,
  clearExternalReceiptCookie,
  EXTERNAL_ACCESS_COOKIE,
  EXTERNAL_RECEIPT_COOKIE,
  setExternalAccessCookie,
  setExternalReceiptCookie,
} from '../helpers/external-signature-cookie';
import { EsignSigningService } from '../services/esign-signing.service';
import { EsignTokenService } from '../services/esign-token.service';
import { ExternalAccessService } from '../services/external-access.service';
import { EsignCompletionAccessService } from '../services/esign-completion-access.service';
import { allowPdfPreview } from '../helpers/pdf-frame-policy';

@Public()
@Controller()
export class ExternalSignatureController {
  constructor(
    private readonly external: ExternalAccessService,
    private readonly signing: EsignSigningService,
    private readonly tokens: EsignTokenService,
    private readonly config: ConfigService,
    private readonly completions: EsignCompletionAccessService,
  ) {}

  @Get('external-signature-invitations/:token')
  getBridge(@Param('token') token: string, @Res() reply: FastifyReply): void {
    if (!this.external.isTokenFormat(token)) {
      throw new AppException(
        AppErrorCode.INVALID_REQUEST,
        '邀請連結格式錯誤',
        HttpStatus.BAD_REQUEST,
      );
    }
    const nonce = randomBytes(18).toString('base64');
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Content-Security-Policy',
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      )
      .type('text/html; charset=utf-8')
      .send(
        '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>開啟電子簽署</title></head><body>' +
          '<form method="post" action="/api/external-signature-session">' +
          `<input type="hidden" name="token" value="${token}">` +
          `<button nonce="${nonce}" type="submit">開啟電子簽署文件</button>` +
          '</form></body></html>',
      );
  }

  @UseGuards(OriginGuard)
  @Post('external-signature-session')
  async createSession(
    @Body('token') token: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!this.external.isTokenFormat(token)) {
      throw new AppException(
        AppErrorCode.INVALID_REQUEST,
        '邀請連結格式錯誤',
        HttpStatus.BAD_REQUEST,
      );
    }
    const session = await this.external.createSession(token);
    setExternalAccessCookie(
      reply,
      this.config,
      token,
      session.invitationExpiresAt,
    );
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .redirect(
        `/external-signatures/${session.signerPublicId}`,
        HttpStatus.SEE_OTHER,
      );
  }

  @UseGuards(OriginGuard)
  @Delete('external-signature-session')
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(@Res({ passthrough: true }) reply: FastifyReply): void {
    clearExternalAccessCookie(reply);
  }

  @UseGuards(OriginGuard)
  @Post('external-signing-task')
  @HttpCode(HttpStatus.OK)
  open(@Req() request: FastifyRequest) {
    return this.external.task(this.accessToken(request), true);
  }

  @Get('external-signing-task/source-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async source(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.external.source(this.accessToken(request));
    if (!file) throw this.unauthorized();
    allowPdfPreview(reply);
    reply
      .type('application/pdf')
      .header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      )
      .send(file.bytes);
  }

  @UseGuards(OriginGuard)
  @Post('external-signing-task/signatures')
  async sign(
    @Body() body: SignatureSubmissionDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = this.accessToken(request);
    const signerPublicId = await this.external.signingSignerPublicId(token);
    const result = await this.signing.sign(
      signerPublicId,
      { kind: 'external', invitationDigest: this.tokens.digest(token) },
      body,
      {
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      },
    );
    clearExternalAccessCookie(reply);
    if ('receiptToken' in result && result.receiptToken) {
      setExternalReceiptCookie(
        reply,
        this.config,
        signerPublicId,
        result.receiptToken,
      );
    }
    reply.status(result.repeated ? HttpStatus.OK : HttpStatus.CREATED);
    return {
      signerPublicId: result.signerPublicId,
      signedAt: result.signedAt.toISOString(),
      documentStatus: result.documentStatus,
    };
  }

  private accessToken(request: FastifyRequest): string {
    const token = cookieTokenFromMap(request.cookies, EXTERNAL_ACCESS_COOKIE);
    if (!token || !this.external.isTokenFormat(token))
      throw this.unauthorized();
    return token;
  }

  @Get('external-completions/:signerPublicId')
  completionStatus(
    @Param('signerPublicId') signerPublicId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.completions.receiptStatus(
      signerPublicId,
      this.receiptToken(request),
    );
  }

  @Get('external-completions/:signerPublicId/completed-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async completionFile(
    @Param('signerPublicId') signerPublicId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.completions.receiptFile(
      signerPublicId,
      this.receiptToken(request),
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

  @Get('external-completions/:signerPublicId/history')
  completionHistory(
    @Param('signerPublicId') signerPublicId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.completions.receiptHistory(
      signerPublicId,
      this.receiptToken(request),
    );
  }

  @UseGuards(OriginGuard)
  @Delete('external-completions/:signerPublicId/session')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearReceipt(
    @Param('signerPublicId') signerPublicId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        signerPublicId,
      )
    ) {
      throw new AppException(
        AppErrorCode.INVALID_REQUEST,
        '簽署人識別格式錯誤',
        HttpStatus.BAD_REQUEST,
      );
    }
    clearExternalReceiptCookie(reply, signerPublicId);
  }

  private receiptToken(request: FastifyRequest): string {
    const token = cookieTokenFromMap(request.cookies, EXTERNAL_RECEIPT_COOKIE);
    if (!token || !this.external.isTokenFormat(token))
      throw this.unauthorized();
    return token;
  }

  private unauthorized(): AppException {
    return new AppException(
      AppErrorCode.ESIGN_EXTERNAL_UNAUTHORIZED,
      '外部簽署存取已失效',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
