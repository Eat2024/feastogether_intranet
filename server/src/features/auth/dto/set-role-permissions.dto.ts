import { ArrayUnique, IsArray, IsInt } from 'class-validator';

/** POST /api/roles/:id/permissions — 交易式整組覆蓋權限（可為空陣列＝清空，ADMIN 除外）。 */
export class SetRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  permissionIds!: number[];
}
