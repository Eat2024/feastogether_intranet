import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppErrors } from '#app/common/errors/app-errors';
import {
  Equals,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
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

/** 當次下載設定：不保存檔名，空白沿用既有預設。 */
export class PrepareExportDownloadDto {
  @ApiProperty({ enum: ['excel'] })
  @Equals('excel', { message: AppErrors.ESIGN_EXPORT_DOWNLOAD_TYPE_INVALID[1] })
  type!: 'excel';

  @ApiPropertyOptional({
    description:
      'trim 後最多 100 Unicode 字元；省略或空白沿用預設，不接受 null',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: AppErrors.ESIGN_EXPORT_FILE_NAME_INVALID[1] })
  fileName?: string;
}

export class PreparedExportDownloadDto {
  @ApiProperty({ enum: ['excel'] })
  type!: 'excel';

  @ApiProperty({
    type: String,
    nullable: true,
    description: '正規化後的當次名稱；null 表示由 Excel 產檔器沿用既有預設',
  })
  fileName!: string | null;
}
