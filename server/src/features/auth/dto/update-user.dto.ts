import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * PATCH /api/users/:empId — 部分更新；未建檔且有 roleId 時從 fgapi 匯入。
 * 三欄皆 optional：未帶 = 不動。roleId 帶數字 = 覆蓋指派。
 */
export class UpdateUserDto {
  @IsOptional()
  @IsInt()
  roleId?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
