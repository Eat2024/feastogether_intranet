import { Transform } from 'class-transformer';
import { IsISO8601, IsString, Length, Matches } from 'class-validator';
import { AppErrors } from '#app/common/errors/app-errors';

const message = AppErrors.ESIGN_REOPEN_INPUT_INVALID[1];
const instant =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export class ReopenDocumentDto {
  @IsISO8601({ strict: true }, { message })
  @Matches(instant, { message })
  expectedSignEndAt!: string;

  @IsISO8601({ strict: true }, { message })
  @Matches(instant, { message })
  signEndAt!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message })
  @Length(1, 500, { message })
  reason!: string;
}

/** 使用端點專用驗證管線，提供穩定的補簽錯誤碼。 */
export type ReopeningInput = Pick<ReopenDocumentDto, keyof ReopenDocumentDto>;
