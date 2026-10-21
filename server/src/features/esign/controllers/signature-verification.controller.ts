import { ApiOperation } from '@nestjs/swagger';
import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '#app/framework/decorators/public.decorator';
import { AuthThrottlerGuard } from '#app/framework/guards/auth-throttler.guard';
import type { SignatureVerificationDto } from '../dto/signature-verification.dto';
import { EsignVerificationService } from '../services/esign-verification.service';

/** 公開簽章驗證：不需登入、不讀寫 cookie，與 /esign/* 員工 session 端點分開。 */
@Public()
@Controller('signature-verifications')
export class SignatureVerificationController {
  constructor(private readonly verification: EsignVerificationService) {}

  // 以公開驗證代碼查詢單一簽章與文件完整性，不需員工登入。
  @UseGuards(AuthThrottlerGuard)
  @ApiOperation({
    summary: '以驗證代碼查詢單一簽章的驗證結果',
    description:
      '路徑 /signature-verifications/{code}，code 為簽署時產生的 22 字驗證代碼。不需登入，沿用登入端點的 client IP 限流（每 60 秒 10 次、每 300 秒 50 次）；只讀，不寫任何資料或稽核事件。格式錯誤、查無或尚未簽署一律回相同 404；完成文件的驗證快照、完成文件摘要或稽核鏈不一致回 409。\n\n前端串接參考：公開驗證頁 /verify/[code] 以同源 fetch 呼叫，只顯示本 API 回傳的欄位。',
  })
  // 以 wildcard 接住任何長度或含 / 的路徑，格式錯誤也走同一個 404 與標頭
  @Get('*')
  verify(
    @Param('*') code: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SignatureVerificationDto> {
    // 先設定標頭，404/409 錯誤回應同樣不被快取、不外送 referrer
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer');
    return this.verification.verify(code);
  }
}
