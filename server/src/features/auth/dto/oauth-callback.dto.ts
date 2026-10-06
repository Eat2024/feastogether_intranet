import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

/**
 * 統一登入回呼（前端 `/oauth/callback` 頁擷取 query 後同源 POST）。
 * 只接受 state、code／error（擇一）、iss；不接受 token、userId、redirect_uri 或 redirectTo 覆寫。
 */
export class OauthCallbackDto {
  @ApiProperty({ description: '授權請求時由本系統產生的 state' })
  @IsString()
  @Length(1, 256)
  @Matches(/^[\x21-\x7e]+$/, { message: 'state 只允許可見 ASCII 字元' })
  state!: string;

  @ApiPropertyOptional({ description: '上游授權碼（與 error 擇一）' })
  @ValidateIf((dto: OauthCallbackDto) => dto.error === undefined)
  @IsString()
  @Length(1, 4096)
  code?: string;

  @ApiPropertyOptional({
    description: '上游錯誤碼（與 code 擇一，例如 access_denied）',
  })
  @ValidateIf((dto: OauthCallbackDto) => dto.code === undefined)
  @IsString()
  @Length(1, 128)
  error?: string;

  @ApiPropertyOptional({
    description: 'RFC 9207 iss；存在時必須等於配置 issuer',
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  iss?: string;
}
