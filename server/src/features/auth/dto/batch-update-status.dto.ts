import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * PATCH /api/users/status — 依 empId 陣列批次更新啟用狀態（atomic）。
 * 停用（isActive=false）時後端擋超管；啟用不擋。上限 500 筆（ponytail: 量再大改分批）。
 */
export class BatchUpdateStatusDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  empIds!: string[];

  @IsBoolean()
  isActive!: boolean;

  /**
   * 回傳範圍（選填）：帶入則回傳「該角色全部使用者」的最新列資料供整個 tab 重繪；
   * 未帶則回傳這批 empIds 的最新資料。不影響「更新哪些人」（更新一律由 empIds 驅動）。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roleId?: number;
}
