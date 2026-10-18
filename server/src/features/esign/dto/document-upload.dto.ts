import { AppErrors } from '#app/common/errors/app-errors';
import { plainToInstance, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { FieldPlacementDto } from './field.dto';

/** multipart 的 fields 為 JSON 字串；解析失敗時保留原值，交由 IsArray 拒絕。 */
function parseFieldsJson({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? plainToInstance(FieldPlacementDto, parsed)
      : parsed;
  } catch {
    return value;
  }
}

/** 共用欄位只屬於文件；上傳與發起均不指定欄位簽署人。 */
class DraftFieldsDto {
  @IsOptional()
  @Transform(parseFieldsJson)
  @IsArray({ message: AppErrors.ESIGN_FIELDS_ARRAY_REQUIRED[1] })
  @ArrayMaxSize(200, { message: AppErrors.ESIGN_FIELD_LIMIT_EXCEEDED[1] })
  @ValidateNested({ each: true })
  fields?: FieldPlacementDto[];
}

export class CreateDocumentDto extends DraftFieldsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: AppErrors.ESIGN_TITLE_REQUIRED[1] })
  @Length(1, 200, { message: AppErrors.ESIGN_TITLE_LENGTH_INVALID[1] })
  title!: string;
}

export class UpdateDocumentDto extends DraftFieldsDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: AppErrors.ESIGN_TITLE_STRING_REQUIRED[1] })
  @Length(1, 200, { message: AppErrors.ESIGN_TITLE_LENGTH_INVALID[1] })
  title?: string;
}
