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

/** 匯出工作的公開投影，不包含快照或儲存位置。 */
export class ExportJobViewDto {
  id!: string;
  documentId!: string;
  status!: string;
  snapshotAt!: string | null;
  expectedCount!: number;
  processedCount!: number;
  waitingCount!: number;
  completedAt!: string | null;
  expiresAt!: string | null;
  failureCode!: string | null;
  files!: {
    id: string;
    fileName: string;
    size: number;
    sha256: string;
    downloadPath: string;
  }[];
}
