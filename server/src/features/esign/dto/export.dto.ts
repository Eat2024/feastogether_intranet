import type { ExportedByDto } from './export-history.dto';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppErrors } from '#app/common/errors/app-errors';
import {
  Equals,
  IsInt,
  IsIn,
  IsUUID,
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
  exportedBy!: ExportedByDto;
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
export class ExportDownloadFileNameDto {
  @ApiPropertyOptional({
    description:
      'trim 後最多 100 Unicode 字元；省略或空白沿用預設，不接受 null',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: AppErrors.ESIGN_EXPORT_FILE_NAME_INVALID[1] })
  fileName?: string;
}

export class PrepareExportDownloadDto extends ExportDownloadFileNameDto {
  @ApiProperty({ enum: ['excel', 'zip'] })
  @IsIn(['excel', 'zip'], {
    message: AppErrors.ESIGN_EXPORT_DOWNLOAD_TYPE_INVALID[1],
  })
  type!: 'excel' | 'zip';

  @ApiPropertyOptional({ description: 'ZIP 必填的匯出工作 UUID；Excel 不接受' })
  @ValidateIf((body: PrepareExportDownloadDto) => body.type === 'zip')
  @IsUUID('all', {
    message: AppErrors.ESIGN_EXPORT_DOWNLOAD_REFERENCE_INVALID[1],
  })
  exportId?: string;

  @ApiPropertyOptional({ description: 'ZIP 必填的成果 ID；Excel 不接受' })
  @ValidateIf((body: PrepareExportDownloadDto) => body.type === 'zip')
  @Matches(NUMERIC_ID_PATTERN, {
    message: AppErrors.ESIGN_EXPORT_DOWNLOAD_REFERENCE_INVALID[1],
  })
  fileId?: string;
}

export class PreparedExportDownloadDto {
  @ApiProperty({ enum: ['excel', 'zip'] })
  type!: 'excel' | 'zip';

  @ApiProperty({
    type: String,
    nullable: true,
    description: '正規化後的當次名稱；null 表示由 Excel 產檔器沿用既有預設',
  })
  fileName!: string | null;

  @ApiPropertyOptional({
    description: '僅 ZIP 回傳：不含檔名的同源相對下載路徑',
  })
  downloadPath?: string;
}

export class ExportDownloadQueryDto {
  @ApiPropertyOptional({
    enum: ['client'],
    description: '由同源下載連結提供建議名稱；省略則沿用成果名稱',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Equals('client', {
    message: AppErrors.ESIGN_EXPORT_DOWNLOAD_NAME_MODE_INVALID[1],
  })
  downloadName?: 'client';
}
