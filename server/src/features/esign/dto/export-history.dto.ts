import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  EXPORT_CONDITION_FIELDS,
  EXPORT_CONDITION_STATUSES,
  type ExportConditions,
} from '../entities/esign-export-job.entity';
import {
  ESIGN_SIGNER_RESULT_FIELDS,
  EsignDocumentCreatorDto,
  EsignSignerViewDto,
} from './esign-common.dto';
import { NUMERIC_ID_PATTERN } from './export.dto';

/** 歷史匯出文件頁的頁籤：簽署紀錄清單 Excel、單人已簽 PDF、已簽署副本 ZIP。 */
export const EXPORT_HISTORY_TYPES = ['excel', 'pdf', 'zip'] as const;
export type ExportHistoryType = (typeof EXPORT_HISTORY_TYPES)[number];

export class ExportHistoryQueryDto {
  /** 紀錄類型 */
  @IsIn(EXPORT_HISTORY_TYPES) type!: ExportHistoryType;
  /** 頁碼，從 1 開始 */
  @ApiPropertyOptional({ type: Number, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;
  /** 每頁筆數 */
  @ApiPropertyOptional({ type: Number, default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;
  /** 限定單一文件，同時套用到 typeTotals */
  @IsOptional() @Matches(NUMERIC_ID_PATTERN) documentId?: string;
}

export class ExportHistoryDocumentDto {
  id!: string;
  title!: string;
  /** 文件 UUID */
  docNumber!: string;
}

/** 匯出人：員工有 employeeNo、email 為 null；外部簽署人相反。 */
export class ExportedByDto {
  name!: string;
  employeeNo!: string | null;
  email!: string | null;
}

/** Excel 匯出條件；記錄與查詢共用，形狀與 DB 的 conditions_json 相同。 */
export class ExportConditionsDto implements ExportConditions {
  /** 簽署狀態，空陣列表示全部 */
  @ApiProperty({ enum: EXPORT_CONDITION_STATUSES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(EXPORT_CONDITION_STATUSES, { each: true })
  statuses!: ExportConditions['statuses'];
  /** 部門鍵，空陣列表示全部；每個鍵 1–1400 字（部門快照最長 150 字，編碼後 1352 字），最多 500 個 */
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 1400, { each: true })
  depts!: string[];
  /** 匯出欄位，至少一個 */
  @ApiProperty({ enum: EXPORT_CONDITION_FIELDS, isArray: true, minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(EXPORT_CONDITION_FIELDS, { each: true })
  fields!: ExportConditions['fields'];
}

/** 前端下載 Excel 前回報的匯出紀錄；匯出人取自 session。 */
export class CreateExcelExportRecordDto {
  /** 只接受 excel；PDF 與 ZIP 由後端自行記錄 */
  @ApiProperty({ enum: ['excel'] })
  @Equals('excel')
  type!: 'excel';
  /** 已發起且未刪除的文件 ID；不限建立人 */
  @Matches(NUMERIC_ID_PATTERN)
  documentId!: string;
  /** 畫面顯示用範圍說明，trim 後 1–2000 字；超過 255 字時存成前 254 字加「…」 */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 2000)
  scope!: string;
  /** 匯出筆數，0 以上整數 */
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  count!: number;
  @IsObject()
  @ValidateNested()
  @Type(() => ExportConditionsDto)
  conditions!: ExportConditionsDto;
}

export class ExportHistoryFileDto {
  id!: string;
  fileName!: string;
  size!: number;
  sha256!: string;
  downloadPath!: string;
}

/**
 * 一筆匯出紀錄。`conditions` 只在 excel 出現；`signerPublicId` 只在 pdf 出現；
 * `documentId` 以下的欄位只在 zip 出現，與 ZIP 匯出工作狀態相同。
 */
export class ExportHistoryItemDto {
  /** 紀錄 UUID；zip 即匯出工作 id */
  id!: string;
  type!: ExportHistoryType;
  document!: ExportHistoryDocumentDto;
  exportedBy!: ExportedByDto;
  exportedAt!: string;
  /** 範圍說明 */
  scope!: string;
  /** 筆數 */
  count!: number;
  conditions?: ExportConditionsDto;
  signerPublicId?: string;
  documentId?: string;
  status?: string;
  snapshotAt?: string | null;
  expectedCount?: number;
  processedCount?: number;
  waitingCount?: number;
  completedAt?: string | null;
  expiresAt?: string | null;
  failureCode?: string | null;
  files?: ExportHistoryFileDto[];
}

export class ExportTypeTotalsDto {
  excel!: number;
  pdf!: number;
  zip!: number;
}

export class ExportHistoryPageDto {
  items!: ExportHistoryItemDto[];
  page!: number;
  pageSize!: number;
  /** 查詢類型的總筆數 */
  total!: number;
  /** 各類型的總筆數 */
  typeTotals!: ExportTypeTotalsDto;
}

/** Excel 用的簽署人：欄位名稱與文件詳情相同，不含 publicId、管理備註、通知結果與驗證網址。 */
export class ExcelExportSignerDto extends PickType(
  EsignSignerViewDto,
  ESIGN_SIGNER_RESULT_FIELDS,
) {}

/** Excel 重新下載資料：文件目前的資料，只含產生 Excel 需要的欄位。 */
export class ExcelExportDocumentDto {
  id!: string;
  title!: string;
  /** 文件 UUID */
  docNumber!: string;
  signStartAt!: string | null;
  signEndAt!: string | null;
  /** 發起時固定的截止時間；重新開放後與 signEndAt 不同 */
  originalSignEndAt!: string | null;
  isReopened!: boolean;
  /** 建立人帳號不存在時為 null */
  createdBy!: EsignDocumentCreatorDto | null;
  signers!: ExcelExportSignerDto[];
}
