import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import configPath from '#app/config/config.path';
import { cookieTokenFromMap } from '#app/common/http/cookie-token.helper';
import { OAUTH_TX_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { OauthCallbackDto } from '#app/features/auth/dto/oauth-callback.dto';
import { OauthStartDto } from '#app/features/auth/dto/oauth-start.dto';
import {
  clearOauthTxCookie,
  setAuthCookie,
  setOauthTxCookie,
} from '#app/features/auth/helpers/auth-cookie';
import { OauthLoginService } from '#app/features/auth/services/oauth-login.service';
import { Public } from '#app/framework/decorators/public.decorator';
import { AuthThrottlerGuard } from '#app/framework/guards/auth-throttler.guard';
import { OriginGuard } from '#app/framework/guards/origin.guard';

/**
 * 饗賓統一登入（038）。兩支皆 Public＋Origin 防護＋認證限流，回應 no-store；
 * 前端只拿到授權網址與登入結果，OAuth token／secret 不進 JSON。
 */
@ApiTags('auth')
@Controller(configPath.AUTH_OAUTH)
export class OauthController {
  constructor(
    private readonly login: OauthLoginService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @UseGuards(OriginGuard, AuthThrottlerGuard)
  @Post(configPath.AUTH_OAUTH_START)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: '發起統一登入：建立登入交易並回授權網址（瀏覽器整頁導向）',
  })
  async start(
    @Body() dto: OauthStartDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { authorizationUrl, browserToken } = await this.login.start(
      dto.redirectTo,
    );
    setOauthTxCookie(reply, this.config, browserToken);
    return { authorizationUrl };
  }

  @Public()
  @UseGuards(OriginGuard, AuthThrottlerGuard)
  @Post(configPath.AUTH_OAUTH_CALLBACK)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      '統一登入回呼：以 code／state 完成驗證並下發本系統 HttpOnly cookie',
  })
  async callback(
    @Body() dto: OauthCallbackDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const browserToken = cookieTokenFromMap(req.cookies, OAUTH_TX_COOKIE_NAME);
    // 那code去換access token
    const { accessToken, session, redirectTo } =
      await this.login.getAccessTokenAndUserInfo(dto, browserToken);
    clearOauthTxCookie(reply);
    setAuthCookie(reply, this.config, accessToken);
    return { session, redirectTo };
  }
}
