import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SignerInputDto } from './signer.dto';

/** 草稿可保存部分期間；null 清空，未傳保留。 */
export class DraftSettingsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SignerInputDto)
  signers?: SignerInputDto[];

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  signStartAt?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  signEndAt?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  watermark?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  allowReject?: boolean;
}
