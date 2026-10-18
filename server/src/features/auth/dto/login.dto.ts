import { AppErrors } from '#app/common/errors/app-errors';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** 工號只去除前後空白；密碼原樣交由上游驗證。 */
export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/^[A-Za-z0-9]+$/, { message: AppErrors.EMPLOYEE_ID_INVALID[1] })
  @MaxLength(32)
  empId!: string;

  @IsString()
  @IsNotEmpty({ message: AppErrors.PASSWORD_REQUIRED[1] })
  @MaxLength(128)
  password!: string;
}
