import {
  plainToInstance,
  Transform,
  type ClassConstructor,
} from 'class-transformer';
import {
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
  validateSync,
  type ValidationOptions,
} from 'class-validator';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';

/** 管理 ID 只接受正整數字串；不讓 Number 靜默四捨五入。 */
export function parseAuthorizationId(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new AppException(...AppErrors.AUTHORIZATION_REQUEST_FORMAT_INVALID);
  return Number(value);
}
export function IsAuthorizationId(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isAuthorizationId',
      validator: {
        validate(value: unknown) {
          try {
            parseAuthorizationId(value);
            return true;
          } catch {
            return false;
          }
        },
      },
    },
    options,
  );
}
/** HTTP 與 REPL 共用嚴格輸入邊界，錯誤不回送輸入內容。 */
export function authorizationInput<T extends object>(
  type: ClassConstructor<T>,
  input: unknown,
): T {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new AppException(...AppErrors.AUTHORIZATION_REQUEST_FORMAT_INVALID);
  const dto = plainToInstance(type, input);
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
    throw new AppException(...AppErrors.AUTHORIZATION_REQUEST_FORMAT_INVALID);
  return dto;
}
export class AuthorizationModuleParamsDto {
  @IsString()
  @Length(1, 50)
  @Matches(/^[a-z][a-z0-9-]*$/)
  moduleKey!: string;
}
export class AuthorizationRoleParamsDto extends AuthorizationModuleParamsDto {
  @IsAuthorizationId() roleId!: string;
}
export class AuthorizationUserParamsDto extends AuthorizationModuleParamsDto {
  @IsAuthorizationId() userId!: string;
}
export const queryInteger = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
    ? Number(value)
    : value;
export class AuthorizationPageDto {
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsAuthorizationId()
  beforeId?: string;
}
export class AuthorizationEventsQueryDto extends AuthorizationPageDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Length(1, 50)
  @Matches(/^[a-z][a-z0-9-]*$/)
  moduleKey?: string;
}
export function authorizationIdString(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new AppException(...AppErrors.AUTHORIZATION_UNAVAILABLE);
  return String(value);
}
