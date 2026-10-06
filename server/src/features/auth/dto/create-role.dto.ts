import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** POST /api/roles — 新增角色（roleCode 由後端產生，不可前端傳）。 */
export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  roleName!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  permissionIds?: number[];
}
