import { IsString, Length, ValidateBy } from 'class-validator';
import { SUPER_USER_PASSWORD_MAX_BYTES } from '../helpers/super-user-password';

const ACCOUNT_MESSAGE = '帳號須為 1～128 字元';
const PASSWORD_MESSAGE = `密碼須為 1～${SUPER_USER_PASSWORD_MAX_BYTES} UTF-8 bytes`;

/** 帳密原樣交給 KDF，不 trim／normalize；多餘欄位由全域 ValidationPipe 拒絕。 */
export class SuperUserLoginDto {
  @IsString({ message: ACCOUNT_MESSAGE })
  @Length(1, 128, { message: ACCOUNT_MESSAGE })
  account!: string;

  // 不用 IsByteLength：它以 encodeURI 計算，遇到孤立 surrogate 會丟例外而變成 500。
  @ValidateBy(
    {
      name: 'utf8ByteLength',
      validator: {
        validate: (value) => {
          if (typeof value !== 'string') return false;
          const bytes = Buffer.byteLength(value, 'utf8');
          return bytes >= 1 && bytes <= SUPER_USER_PASSWORD_MAX_BYTES;
        },
      },
    },
    { message: PASSWORD_MESSAGE },
  )
  password!: string;
}
