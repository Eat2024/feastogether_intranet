import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 發起統一登入：只收登入後要返回的站內路徑（合法性由 sanitizeRedirectTo 判定）。 */
export class OauthStartDto {
  @ApiPropertyOptional({
    description: '登入完成後返回的站內相對路徑；不合法或缺省時進首頁',
    example: '/permissionManagement/roleManagement',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  redirectTo?: string;
}
