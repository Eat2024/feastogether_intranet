import { AppErrors } from '#app/common/errors/app-errors';
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
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { cookieTokenFromMap } from '#app/common/http/cookie-token.helper';
import { AppException } from '#app/common/errors/app.exception';
import { Public } from '#app/framework/decorators/public.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SignatureSubmissionDto } from '../dto/signature-submission.dto';
import {
  clearExternalAccessCookie,
  EXTERNAL_ACCESS_COOKIE,
  setExternalAccessCookie,
} from '../helpers/external-signature-cookie';
import {
  EsignSigningService,
  toSignatureResultView,
} from '../services/esign-signing.service';
import { EsignTokenService } from '../services/esign-token.service';
import { ExternalAccessService } from '../services/external-access.service';
import { allowPdfPreview } from '../helpers/pdf-frame-policy';
import {
  invitationConfirmPage,
  invitationInvalidPage,
  serviceUnavailablePage,
} from '../helpers/external-invitation-page';

@Public()
@Controller()
export class ExternalSignatureController {
  constructor(
    private readonly external: ExternalAccessService,
    private readonly signing: EsignSigningService,
    private readonly tokens: EsignTokenService,
    private readonly config: ConfigService,
  ) {}

  @ApiOperation({
    summary: '開啟外部簽署邀請確認頁',
    description:
      '回傳邀請確認頁（含「開啟電子簽署文件」按鈕的 HTML 表單），此 GET 不查詢資料、不記錄、不建立簽署 session；token 格式錯誤時回 400 失效頁。\n\n前端串接參考：外部簽署人點擊 Email 邀請連結進入此後端頁面，再按按鈕送出 POST external-signature-session；不是 Next.js 頁面直接呼叫。',
  })
  @Get('external-signature-invitations/:token')
  getBridge(@Param('token') token: string, @Res() reply: FastifyReply): void {
    this.setInvitationPageHeaders(reply);
    if (!this.external.isTokenFormat(token)) {
      this.sendInvitationPage(
        reply,
        HttpStatus.BAD_REQUEST,
        invitationInvalidPage(),
      );
      return;
    }
    this.sendInvitationPage(reply, HttpStatus.OK, invitationConfirmPage(token));
  }

  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '建立外部簽署存取 session',
    description:
      '驗證邀請 token，設定 HttpOnly 存取 cookie，並以 303 導向外部簽署頁；token 格式錯誤（400）、邀請無效或過期（401）時回相同的失效頁，服務暫時無法使用時回服務暫停頁。\n\n前端串接參考：由邀請確認頁的 HTML 表單送出，成功導向 /external-signatures/[signerPublicId]。',
  })
  @Post('external-signature-session')
  async createSession(
    @Body('token') token: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.setInvitationPageHeaders(reply);
    if (!this.external.isTokenFormat(token)) {
      this.sendInvitationPage(
        reply,
        HttpStatus.BAD_REQUEST,
        invitationInvalidPage(),
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
      this.sendInvitationPage(
        reply,
        status,
        status >= 500 ? serviceUnavailablePage() : invitationInvalidPage(),
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
  @ApiOperation({
    summary: '送出外部簽署人簽名',
    description:
      '以外部存取 cookie 驗證並提交同意紀錄與簽名；成功後清除存取 cookie，並回傳該簽章的公開驗證網址 verificationUrl。\n\n前端串接參考：ExternalSignFlow 送出簽名時直接 fetch，成功後直接顯示簽署成功與驗證網址，完成 PDF 請向建立人取得。',
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
    reply.status(result.repeated ? HttpStatus.OK : HttpStatus.CREATED);
    return toSignatureResultView(result);
  }

  private accessToken(request: FastifyRequest): string {
    const token = cookieTokenFromMap(request.cookies, EXTERNAL_ACCESS_COOKIE);
    if (!token || !this.external.isTokenFormat(token))
      throw this.unauthorized();
    return token;
  }

  private unauthorized(): AppException {
    return new AppException(...AppErrors.ESIGN_EXTERNAL_UNAUTHORIZED);
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

  /** 邀請頁一律回 HTML（包含錯誤），不讓外部簽署人看到 JSON。 */
  private sendInvitationPage(
    reply: FastifyReply,
    status: number,
    html: string,
  ): void {
    reply.status(status).type('text/html; charset=utf-8').send(html);
  }
}
