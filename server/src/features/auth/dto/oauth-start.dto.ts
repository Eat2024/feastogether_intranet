import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** 發起統一登入：可傳入登入後要返回的路徑。 */
export class OauthStartDto {
  @ApiPropertyOptional({
    description: '登入完成後返回的路徑；缺省時進首頁',
    example: '/documents',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  redirectTo?: string;
}
