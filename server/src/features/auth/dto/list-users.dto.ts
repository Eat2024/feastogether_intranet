import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** GET /api/users — 分頁 + 關鍵字模糊搜尋（姓名/工號/部門/角色名稱）+ 角色 tab 篩選。 */
export class ListUsersDto {
  /** 放大鏡：姓名/工號/部門/角色名稱 模糊搜尋。 */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  /** 角色 tab：依角色 id 精準篩選（與 keyword 可同時生效）。 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roleId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /** 每頁筆數——全站統一 `pageSize`、預設 50、上限 200。 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 50;
}
