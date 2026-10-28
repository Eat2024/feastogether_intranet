import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

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
  @IsOptional() @Matches(/^[1-9][0-9]{0,14}$/) documentId?: string;
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

/** Excel 匯出條件；空陣列表示全部。 */
export class ExportConditionsDto {
  statuses!: string[];
  depts!: string[];
  fields!: string[];
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
