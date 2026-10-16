import { ApiOperation } from '@nestjs/swagger';
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
import { AppException } from '#app/common/errors/app.exception';
import { cookieTokenFromMap } from '#app/common/http/cookie-token.helper';
import { sendHtmlErrorPage } from '#app/common/http/html-error-page';
import { Public } from '#app/framework/decorators/public.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SignatureSubmissionDto } from '../dto/signature-submission.dto';
import {
  externalUnauthorized,
  invalidRequest,
  stateConflict,
} from '../helpers/esign-errors';
import {
  clearExternalAccessCookie,
  clearExternalReceiptCookie,
  EXTERNAL_ACCESS_COOKIE,
  EXTERNAL_RECEIPT_COOKIE,
  setExternalAccessCookie,
  setExternalReceiptCookie,
} from '../helpers/external-signature-cookie';
import {
  EsignSigningService,
  toSignatureResultView,
} from '../services/esign-signing.service';
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
  ) { }

  @ApiOperation({
    summary: '開啟外部簽署邀請確認頁',
    description:
      '回傳含開啟按鈕的 HTML 表單，此 GET 不建立簽署 session；token 格式錯誤時回 HTML 錯誤頁。\n\n前端串接參考：外部簽署人點擊 Email 邀請連結進入此後端頁面，再按按鈕送出 POST external-signature-session；不是 Next.js 頁面直接呼叫。',
  })
  @Get('external-signature-invitations/:token')
  getBridge(@Param('token') token: string, @Res() reply: FastifyReply): void {
    this.setInvitationPageHeaders(reply);
    if (!this.external.isTokenFormat(token)) {
      this.invitationErrorPage(
        reply,
        HttpStatus.BAD_REQUEST,
        '邀請連結格式錯誤',
      );
      return;
    }
    const nonce = randomBytes(18).toString('base64');
    reply
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
  @ApiOperation({
    summary: '建立外部簽署存取 session',
    description:
      '驗證邀請 token，設定 HttpOnly 存取 cookie，並以 303 導向外部簽署頁；token 格式錯誤、邀請無效或過期時回 HTML 錯誤頁。\n\n前端串接參考：由邀請確認頁的 HTML 表單送出，成功導向 /external-signatures/[signerPublicId]。',
  })
  @Post('external-signature-session')
  async createSession(
    @Body('token') token: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.setInvitationPageHeaders(reply);
    if (!this.external.isTokenFormat(token)) {
      this.invitationErrorPage(
        reply,
        HttpStatus.BAD_REQUEST,
        '邀請連結格式錯誤',
      );
      return;
    }
    try {
      const session = await this.external.createSession(token);
      setExternalAccessCookie(
        reply,
        this.config,
        token,
        session.invitationExpiresAt,
      );
      reply.redirect(
        `/external-signatures/${session.signerPublicId}`,
        HttpStatus.SEE_OTHER,
      );
    } catch (error) {
      // 非預期錯誤交給全域 handler 記錄
      if (!(error instanceof AppException)) throw error;
      const status = error.getStatus();
      this.invitationErrorPage(
        reply,
        status,
        status >= 500
          ? '電子簽署服務暫時無法使用，請稍後再試'
          : '邀請連結無效或已到期',
      );
    }
  }

  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '清除外部簽署存取 cookie',
    description:
      '清除目前瀏覽器的外部簽署存取 cookie。\n\n前端串接參考：目前未找到前端呼叫；尚未接到畫面操作。',
  })
  @Delete('external-signature-session')
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(@Res({ passthrough: true }) reply: FastifyReply): void {
    clearExternalAccessCookie(reply);
  }

  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '開啟外部簽署任務',
    description:
      '以外部存取 cookie 驗證邀請，回傳任務並記錄開啟事件，不依賴員工登入。\n\n前端串接參考：/external-signatures/[signerPublicId] 的 ExternalSignFlow 載入時以瀏覽器 fetch 呼叫。',
  })
  @Post('external-signing-task')
  @HttpCode(HttpStatus.OK)
  open(@Req() request: FastifyRequest) {
    return this.external.task(this.accessToken(request), true);
  }

  @ApiOperation({
    summary: '讀取外部簽署任務的原始 PDF',
    description:
      '以外部存取 cookie 驗證後回傳原始 PDF。\n\n前端串接參考：/external-signatures/[signerPublicId] 的 ExternalSignFlow 用來計算頁數，並交由 SignFlow 預覽文件。',
  })
  @Get('external-signing-task/source-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async source(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.external.source(this.accessToken(request));
    if (!file) throw externalUnauthorized();
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
  @ApiOperation({
    summary: '送出外部簽署人簽名',
    description:
      '以外部存取 cookie 驗證並提交同意紀錄與簽名；成功後清除存取 cookie，設定完成回執 cookie，並回傳該簽章的公開驗證網址 verificationUrl。\n\n前端串接參考：ExternalSignFlow 送出簽名時直接 fetch，成功後導向 /external-signatures/[signerPublicId]/completion。',
  })
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
    return toSignatureResultView(result);
  }

  /** 邀請頁由瀏覽器直接開啟（Email 連結、表單送出），不快取、不外送 referrer。 */
  private setInvitationPageHeaders(reply: FastifyReply): void {
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Content-Security-Policy',
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      );
  }

  /** 邀請頁出錯時回 HTML，不讓外部簽署人看到 JSON。 */
  private invitationErrorPage(
    reply: FastifyReply,
    status: number,
    message: string,
  ): void {
    sendHtmlErrorPage(reply, status, '無法開啟電子簽署文件', message);
  }

  private accessToken(request: FastifyRequest): string {
    const token = cookieTokenFromMap(request.cookies, EXTERNAL_ACCESS_COOKIE);
    if (!token || !this.external.isTokenFormat(token))
      throw externalUnauthorized();
    return token;
  }

  @ApiOperation({
    summary: '查詢外部簽署完成狀態',
    description:
      '以完成回執 cookie 查詢文件狀態與本人簽章的公開驗證網址 verificationUrl；不使用原邀請連結作為憑證。\n\n前端串接參考：/external-signatures/[signerPublicId]/completion 的 ExternalCompletion 載入時查詢，顯示等待其他人簽署、產檔中或完成等狀態。',
  })
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

  @ApiOperation({
    summary: '下載外部簽署的完成 PDF',
    description:
      '以完成回執 cookie 驗證後下載全員簽署完成的 PDF；尚未產生時回傳狀態衝突。\n\n前端串接參考：ExternalCompletion 在文件完成後顯示「下載完成文件」連結，直接連到此 API。',
  })
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
    if (!file) throw stateConflict('完成文件尚未產生');
    reply
      .type('application/pdf')
      .header('Content-Disposition', 'attachment; filename="completed.pdf"')
      .send(file.bytes);
  }

  @ApiOperation({
    summary: '查詢外部簽署人可見的歷程',
    description:
      '以完成回執 cookie 驗證，回傳該簽署人可見的事件。\n\n前端串接參考：ExternalCompletion 載入時與完成狀態一起查詢，交由 SigningHistory 顯示。',
  })
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
  @ApiOperation({
    summary: '清除外部簽署完成回執 cookie',
    description:
      '清除目前瀏覽器對應簽署人的完成回執 cookie。\n\n前端串接參考：目前未找到前端呼叫；尚未接到畫面操作。',
  })
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
      throw invalidRequest('簽署人識別格式錯誤');
    }
    clearExternalReceiptCookie(reply, signerPublicId);
  }

  private receiptToken(request: FastifyRequest): string {
    const token = cookieTokenFromMap(request.cookies, EXTERNAL_RECEIPT_COOKIE);
    if (!token || !this.external.isTokenFormat(token))
      throw externalUnauthorized();
    return token;
  }
}
