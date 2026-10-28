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
export class ExportRequestDto {
  @Equals('signed_copies_zip') type!: 'signed_copies_zip';
}
export class ExportQueryDto {
  @IsOptional() @Matches(/^[1-9][0-9]{0,14}$/) cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(20) status?: string;
}
