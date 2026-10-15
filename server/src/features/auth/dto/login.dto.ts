import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** 工號只去除前後空白；密碼原樣交由上游驗證。 */
export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/^[A-Za-z0-9]+$/, { message: '請輸入有效的員工編號' })
  @MaxLength(32)
  empId!: string;

  @IsString()
  @IsNotEmpty({ message: '請輸入密碼' })
  @MaxLength(128)
  password!: string;
}
