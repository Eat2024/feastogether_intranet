import { ApiProperty } from '@nestjs/swagger';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import {
  Equals,
  IsArray,
  IsString,
  Matches,
  ValidateIf,
  validateSync,
} from 'class-validator';

export class OrgEmployeeDto {
  @ApiProperty()
  @IsString()
  person_empid!: string;

  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  person_name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  title!: string | null;
}

export class OrgDepartmentDto {
  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  department_ch_id!: string;

  @ApiProperty()
  @IsString()
  department_name!: string;

  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  department_parent_guid!: string | null;

  @ApiProperty({ type: String, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  startdate!: string | null;

  @ApiProperty({ nullable: true, enum: [null] })
  @Equals(null)
  stopdate!: null;

  @ApiProperty({ type: () => [OrgDepartmentDto] })
  @IsArray()
  children!: OrgDepartmentDto[];

  @ApiProperty({ type: () => [OrgEmployeeDto] })
  @IsArray()
  employees!: OrgEmployeeDto[];
}

function invalid(): never {
  throw new Error('組織架構資料格式錯誤');
}

function parseRecord<T extends object>(
  type: ClassConstructor<T>,
  value: unknown,
): T {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const dto = plainToInstance(type, value);
  if (
    validateSync(dto, { whitelist: true, forbidUnknownValues: true }).length > 0
  )
    return invalid();
  return dto;
}

/** 逐層重建白名單 DTO；任一筆必要欄位錯誤皆整批拒絕，不略過資料。 */
export function parseOrgChart(value: unknown): OrgDepartmentDto[] {
  if (!Array.isArray(value)) return invalid();
  return value.map((item: unknown) => {
    const node = parseRecord(OrgDepartmentDto, item);
    node.children = parseOrgChart(node.children);
    node.employees = node.employees.map((employee: unknown) =>
      parseRecord(OrgEmployeeDto, employee),
    );
    return node;
  });
}
