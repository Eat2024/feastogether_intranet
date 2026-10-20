import { Transform } from 'class-transformer';
import { IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

/** 原因選填；null 不等於未提供。長度依 Unicode code points 計算。 */
export class RejectionDto {
  @IsUUID('4')
  requestId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ExternalRejectionDto extends RejectionDto {
  @IsUUID('4')
  signerPublicId!: string;
}
