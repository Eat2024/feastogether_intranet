import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** fgapi 員編查詢資料；依本地欄位長度驗證，避免外部資料直接落庫。 */
export class StaffLookupDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]+$/)
  @MaxLength(32)
  person_empid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  person_name!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  department_id!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  department_name!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title!: string | null;

  @IsIn([0, 1])
  person_status!: number;

  @IsIn(['試用', '正式'])
  person_status_name!: string;
}
