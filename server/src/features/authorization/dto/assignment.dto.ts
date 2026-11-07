import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  Length,
} from 'class-validator';
import { IsAuthorizationId } from './authorization-query.dto';
/** 員編保留原字元；不得 trim 或轉成數字。 */
export class AssignmentDto {
  @IsString() @Length(1, 32) empId!: string;
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsAuthorizationId({ each: true })
  roleIds!: string[];
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsAuthorizationId({ each: true })
  expectedRoleIds!: string[];
}

/** 管理 API 使用安全 ID 字串，隱含同仁不混入可修改 roleIds。 */
export interface EmployeeRolesDto {
  userId: string;
  moduleKey: string;
  roleIds: string[];
  implicitRoles: Array<{ roleCode: 'colleague'; source: 'baseline' }>;
}
export interface AssignmentResultDto extends EmployeeRolesDto {
  changed: boolean;
}
