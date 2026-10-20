import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';
import { AppErrors } from '#app/common/errors/app-errors';

export class SignerNoteDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: AppErrors.ESIGN_SIGNER_NOTE_INVALID[1] })
  @MaxLength(30, { message: AppErrors.ESIGN_SIGNER_NOTE_INVALID[1] })
  note!: string;
}
