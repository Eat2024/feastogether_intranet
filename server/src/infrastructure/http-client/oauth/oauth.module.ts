import { Module } from '@nestjs/common';
import { OauthClient } from './oauth.client';
import { OauthConfig } from './oauth.config';

/**
 * 饗賓 OAuth／OIDC 集中層（038）。對外只暴露 OauthConfig（旗標）與 OauthClient；
 * issuer／Client secret／logout URL 只在此層讀取，不進 feature 或前端。
 */
@Module({
  providers: [OauthConfig, OauthClient],
  exports: [OauthConfig, OauthClient],
})
export class OauthModule {}
