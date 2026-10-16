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

  @UseGuards(AuthThrottlerGuard)
  @ApiOperation({
    summary: '以驗證代碼查詢單一簽章的驗證結果',
    description:
      '路徑 /signature-verifications/{code}，code 為簽署時產生的 22 字驗證代碼。不需登入。\n\n前端串接參考：公開驗證頁 /verify/[code] 以同源 fetch 呼叫，只顯示本 API 回傳的欄位。',
  })
  @Get(':code')
  verify(
    @Param('code') code: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SignatureVerificationDto> {
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer');
    return this.verification.verify(code);
  }
}
