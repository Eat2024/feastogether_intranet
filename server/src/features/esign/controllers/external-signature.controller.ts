import { EsignRejectionService } from '../services/esign-rejection.service';
import { ExternalRejectionDto } from '../dto/rejection.dto';
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
import { AuthThrottlerGuard } from '#app/framework/guards/auth-throttler.guard';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { ExternalSignatureSubmissionDto } from '../dto/signature-submission.dto';
import {
  clearExternalAccessCookie,
  EXTERNAL_ACCESS_COOKIE,
  setExternalAccessCookie,
} from '../helpers/external-signature-cookie';
import {
  EsignSigningService,
  toSignatureResultView,
} from '../services/esign-signing.service';
import { SigningNotStartedException } from '../services/esign-access-policy.service';
import { ExternalAccessService } from '../services/external-access.service';
import { ExternalOtpService } from '../services/external-otp.service';
import { allowPdfPreview } from '../helpers/pdf-frame-policy';
import {
  INVITATION_PAGE_CSP,
  invitationConfirmPage,
  invitationInvalidPage,
  otpInputPage,
  otpMailFailedPage,
  otpRejectedPage,
  serviceUnavailablePage,
  signingNotStartedPage,
} from '../helpers/external-invitation-page';

@Public()
@Controller()
export class ExternalSignatureController {
  constructor(
    private readonly rejection: EsignRejectionService,
    private readonly external: ExternalAccessService,
    private readonly otp: ExternalOtpService,
    private readonly signing: EsignSigningService,
    private readonly config: ConfigService,
  ) {}

  // 以 Email OTP 存取憑證拒絕本人簽署任務，內外部員工共用。
  @UseGuards(OriginGuard)
  @ApiOperation({ summary: '拒絕外部本人簽署任務' })
  @Post('external-signing-task/rejection')
  async reject(
    @Body() body: ExternalRejectionDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { repeated, ...result } = await this.rejection.reject(
      body.signerPublicId,
      await this.external.signingPrincipal(this.accessCredential(request)),
      body,
    );
    reply.status(repeated ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  // 顯示 Email 邀請確認頁；此步驟不寄送 OTP 或建立 session。
  @ApiOperation({
    summary: '開啟外部簽署邀請確認頁',
    description:
      '回傳邀請確認頁（含「開啟電子簽署文件」按鈕的 HTML 表單），此 GET 不查詢資料、不記錄、不寄驗證碼、不建立簽署 session；token 格式錯誤時回 400 失效頁。\n\n前端串接參考：外部簽署人點擊 Email 邀請連結進入此後端頁面，再按按鈕送出 POST external-signature-otps；不是 Next.js 頁面直接呼叫。',
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

  // 驗證邀請並寄送 OTP 至固定收件信箱。
  @UseGuards(OriginGuard, AuthThrottlerGuard)
  @ApiOperation({
    summary: '寄出 Email 簽署驗證碼（內外部共用）',
    description:
      '以表單欄位 token 驗證邀請；有效（待簽者在簽署期間，或已簽者）時寄 6 位數驗證碼到邀請信箱（10 分鐘有效，舊驗證碼失效），回驗證碼輸入頁（顯示遮罩後的信箱、重新寄送按鈕倒數 60 秒），並記錄 external_otp.sent。距上次寄送未滿 60 秒或同一簽署人 1 小時內已寄滿 5 封時回 429 驗證碼輸入頁並顯示可再寄送的時間，不寄信、不覆寫現有驗證碼。有效邀請但簽署尚未開始回 409 尚未開始頁；token 格式錯誤（400）、邀請無效或過期（401）回相同的失效頁；以上都不寄信。寄信失敗回 503 可重試頁，不保留驗證碼、不計入冷卻與寄送次數。依 IP 限流，request body 不寫入 access log。\n\n前端串接參考：由邀請確認頁與驗證碼輸入頁（重新寄送）的 HTML 表單送出，不是 Next.js 頁面直接呼叫。',
  })
  @Post('external-signature-otps')
  async sendOtp(
    @Body('token') token: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.invitationFlow(
      reply,
      this.external.isTokenFormat(token),
      async () => {
        const { email, issue } = await this.external.sendOtp(token);
        if (issue.status === 'delivery-failed') {
          this.sendInvitationPage(
            reply,
            HttpStatus.SERVICE_UNAVAILABLE,
            otpMailFailedPage(),
          );
          return;
        }
        this.sendInvitationPage(
          reply,
          issue.status === 'sent'
            ? HttpStatus.OK
            : HttpStatus.TOO_MANY_REQUESTS,
          otpInputPage(token, email, issue),
        );
      },
    );
  }

  // 驗證 OTP、建立簽署存取 cookie，並導向簽署頁。
  @UseGuards(OriginGuard, AuthThrottlerGuard)
  @ApiOperation({
    summary: '以驗證碼建立 Email 簽署存取 session（內外部共用）',
    description:
      '以表單欄位 token＋code（6 位數驗證碼）驗證；邀請有效且驗證碼正確時產生隨機存取憑證（不是邀請 token，伺服器只存雜湊、8 小時失效），設為 HttpOnly session cookie（不設期限，關閉瀏覽器即失效，待簽者與已簽者相同）並以 303 導向外部簽署頁，記錄 external_otp.verified 與 external_invitation.opened。驗證碼錯誤回 401 錯誤頁並顯示剩餘次數（錯滿 5 次即失效）；驗證碼過期、已使用或已失效回 401 錯誤頁提示重新寄送。邀請無效或過期回 401 失效頁、token 或 code 格式錯誤回 400 失效頁、尚未開始回 409 尚未開始頁，都不比對驗證碼。依 IP 限流，request body 不寫入 access log。\n\n前端串接參考：由驗證碼輸入頁的 HTML 表單送出，成功導向 /external-signatures/[signerPublicId]。',
  })
  @Post('external-signature-session')
  async createSession(
    @Body('token') token: string,
    @Body('code') code: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const validInput =
      this.external.isTokenFormat(token) && this.otp.isCodeFormat(code);
    await this.invitationFlow(reply, validInput, async () => {
      const session = await this.external.createSession(token, code);
      if (!session.verified) {
        this.sendInvitationPage(
          reply,
          HttpStatus.UNAUTHORIZED,
          otpRejectedPage(token, session.email, session.remainingAttempts),
        );
        return;
      }
      setExternalAccessCookie(reply, this.config, session.credential);
      reply.redirect(
        `/external-signatures/${session.signerPublicId}`,
        HttpStatus.SEE_OTHER,
      );
    });
  }

  // 撤銷請求攜帶的簽署存取憑證並清除 cookie。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '結束外部簽署存取',
    description:
      '刪除請求所帶外部存取 cookie 對應的存取憑證並清除 cookie，之後以同一憑證存取一律 401。\n\n前端串接參考：目前未找到前端呼叫；尚未接到畫面操作。',
  })
  @Delete('external-signature-session')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const credential = cookieTokenFromMap(
      request.cookies,
      EXTERNAL_ACCESS_COOKIE,
    );
    if (credential) await this.external.endSession(credential);
    clearExternalAccessCookie(reply);
  }

  // 以 Email OTP 存取憑證開啟本人任務並記錄開啟事件。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '開啟外部簽署任務',
    description:
      '以 Email OTP 存取 cookie（內外部簽署人共用） 驗證邀請，回傳任務並記錄開啟事件，不依賴員工登入；已簽者也可開啟，不比對簽署期限與文件狀態，依 signer.status 顯示完成頁。\n\n前端串接參考：/external-signatures/[signerPublicId] 的 ExternalSigning 每次進入頁面呼叫一次。',
  })
  @Post('external-signing-task')
  @HttpCode(HttpStatus.OK)
  open(@Req() request: FastifyRequest) {
    return this.external.task(this.accessCredential(request), true);
  }

  // 唯讀查詢本人簽署任務與副本狀態，不記錄開啟事件。
  @ApiOperation({
    summary: '查詢外部簽署任務（唯讀）',
    description:
      '回傳與開啟任務相同的內容，但不記錄開啟事件、不寫入任何資料。\n\n前端串接參考：ExternalSigning 完成頁在本人副本產生中（completion.status 為 pending／processing）時每 3 秒輪詢，ready 或 failed 即停止。',
  })
  @Get('external-signing-task')
  @Header('Cache-Control', 'private, no-store')
  read(@Req() request: FastifyRequest) {
    return this.external.task(this.accessCredential(request), false);
  }

  // 驗證 Email OTP 存取權限後回傳本人任務的原始 PDF。
  @ApiOperation({
    summary: '讀取外部簽署任務的原始 PDF',
    description:
      '以 Email OTP 存取 cookie（內外部簽署人共用） 驗證後回傳原始 PDF；已簽者也可讀取。\n\n前端串接參考：/external-signatures/[signerPublicId] 的 ExternalSigning 用來計算頁數並預覽文件。',
  })
  @Get('external-signing-task/source-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async source(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.external.source(this.accessCredential(request));
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

  // 以 Email OTP 存取憑證提交本人簽名與同意紀錄。
  @UseGuards(OriginGuard)
  @ApiOperation({
    summary: '送出外部簽署人簽名',
    description:
      '以 Email OTP 存取 cookie（內外部簽署人共用） 驗證並提交同意紀錄與簽名，回傳簽署結果（含本人副本狀態 completion 與公開驗證網址 verificationUrl）。body 必須帶頁面所屬的 signerPublicId，與 cookie 對應的簽署人不符（同一瀏覽器後開啟的邀請覆蓋了 cookie）回 409 ESIGN_EXTERNAL_SIGNER_MISMATCH，不建立簽署。首次成功回 201；同一 requestId 重送回 200 與既有結果；已簽者以新的 requestId 再簽回 401。成功不重設 cookie，完成頁沿用同一存取憑證查詢與下載。\n\n前端串接參考：ExternalSignForm 送出簽名，帶上頁面所屬（與網址相同）的 signerPublicId，網路重試沿用同一個 requestId；成功後切換到完成頁。',
  })
  @Post('external-signing-task/signatures')
  async sign(
    @Body() body: ExternalSignatureSubmissionDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.signing.sign(
      body.signerPublicId,
      await this.external.signingPrincipal(this.accessCredential(request)),
      body,
      {
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      },
    );
    reply.status(result.repeated ? HttpStatus.OK : HttpStatus.CREATED);
    return toSignatureResultView(result);
  }

  // 驗證 Email OTP 存取權限與檔案完整性後下載本人已簽副本。
  @ApiOperation({
    summary: '下載外部簽署人的本人副本',
    description:
      '以 Email OTP 存取 cookie（內外部簽署人共用） 驗證後回傳本人的已簽署 PDF（附件），經與建立人下載相同的完整性檢查；不記錄稽核。尚未簽署或存取失效回 401；副本產生中或產製失敗回 409。\n\n前端串接參考：ExternalDone 的「下載已簽署文件」以一般連結直接下載。',
  })
  @Get('external-signing-task/completed-file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async completedFile(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.external.completedFile(
      this.accessCredential(request),
    );
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

  /** 外部存取 cookie 中的存取憑證（與邀請 token 同為 43 字元 base64url）；缺少或格式錯誤回 401 */
  private accessCredential(request: FastifyRequest): string {
    const credential = cookieTokenFromMap(
      request.cookies,
      EXTERNAL_ACCESS_COOKIE,
    );
    if (!credential || !this.external.isTokenFormat(credential))
      throw this.unauthorized();
    return credential;
  }

  private unauthorized(): AppException {
    return new AppException(...AppErrors.ESIGN_EXTERNAL_UNAUTHORIZED);
  }

  /**
   * 邀請流程的表單端點一律回 HTML：輸入格式錯誤回 400 失效頁；預期錯誤依狀態回對應頁面，
   * 非預期錯誤交給全域 handler 記錄。
   */
  private async invitationFlow(
    reply: FastifyReply,
    validInput: boolean,
    run: () => Promise<void>,
  ): Promise<void> {
    this.setInvitationPageHeaders(reply);
    if (!validInput) {
      this.sendInvitationPage(
        reply,
        HttpStatus.BAD_REQUEST,
        invitationInvalidPage(),
      );
      return;
    }
    try {
      await run();
    } catch (error) {
      if (!(error instanceof AppException)) throw error;
      this.sendInvitationPage(
        reply,
        error.getStatus(),
        this.accessErrorPage(error),
      );
    }
  }

  /** 尚未開始告知開始時間；服務異常請稍後再試；其餘一律失效頁，不區分原因。 */
  private accessErrorPage(error: AppException): string {
    if (error instanceof SigningNotStartedException)
      return signingNotStartedPage(error.startAt);
    return error.getStatus() >= 500
      ? serviceUnavailablePage()
      : invitationInvalidPage();
  }

  /** 邀請頁由瀏覽器直接開啟（Email 連結、表單送出），不快取、不外送 referrer。 */
  private setInvitationPageHeaders(reply: FastifyReply): void {
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', INVITATION_PAGE_CSP);
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
