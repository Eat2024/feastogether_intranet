import { Type } from 'class-transformer';
import {
  Equals,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 數字 ID 字串（文件 ID、游標）：正整數、最多 15 位，轉成 Number 仍是安全整數。 */
export const NUMERIC_ID_PATTERN = /^[1-9][0-9]{0,14}$/;

export class ExportRequestDto {
  @Equals('signed_copies_zip') type!: 'signed_copies_zip';
}
export class ExportQueryDto {
  @IsOptional() @Matches(NUMERIC_ID_PATTERN) cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
}
