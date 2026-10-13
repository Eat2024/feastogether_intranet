import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WebviewSessionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  code!: string;
}

export class WebviewLaunchView {
  @ApiProperty({ format: 'uri' })
  launchUrl!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}
