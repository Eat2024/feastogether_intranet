import { IsString, Length, Matches } from 'class-validator';

/** GET /api/users/employees?empId= — fgapi 5～8 碼員編片段模糊搜尋。 */
export class SearchEmployeeOptionsDto {
  @IsString()
  @Length(5, 8)
  @Matches(/^[A-Za-z0-9]+$/)
  empId!: string;
}
