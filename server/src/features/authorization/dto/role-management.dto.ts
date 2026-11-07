import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { queryInteger } from './authorization-query.dto';
export class CreateRoleDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  roleName!: string;
}
export class UpdateRoleDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  roleName?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedVersion!: number;
}
export class SetRolePermissionsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  permissionKeys!: string[];
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedVersion!: number;
}
export class DeleteRoleDto {
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number;
}
export interface AuthorizationRoleDto {
  id: string;
  moduleKey: string;
  roleCode: string;
  roleName: string;
  isActive: boolean;
  isProtected: boolean;
  version: number;
  permissionKeys: string[];
}
