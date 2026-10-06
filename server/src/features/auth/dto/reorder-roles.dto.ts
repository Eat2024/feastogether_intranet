import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** reorder 陣列元素：角色 id + 目標名稱（可一併改名）。 */
export class ReorderRoleItemDto {
  @IsInt()
  roleId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  roleName!: string;
}

/**
 * POST /api/roles/reorder — 依陣列順序重排 sortOrder，並可一併更新角色名稱。
 * roles 須涵蓋全部啟用角色（不漏 / 不多），roleId 不可重複；順序即新的 sortOrder。
 */
export class ReorderRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((item: ReorderRoleItemDto) => item.roleId)
  @ValidateNested({ each: true })
  @Type(() => ReorderRoleItemDto)
  roles!: ReorderRoleItemDto[];
}
