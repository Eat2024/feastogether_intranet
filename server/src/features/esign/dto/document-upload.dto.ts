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

/** 草稿欄位：建立當下尚無簽署人，一律存成未指派，發起時再指派。 */
class DraftFieldsDto {
  @IsOptional()
  @Transform(parseFieldsJson)
  @IsArray({ message: '欄位資料必須為 JSON 陣列' })
  @ArrayMaxSize(200, { message: '欄位數量不可超過 200 個' })
  @ValidateNested({ each: true })
  fields?: FieldPlacementDto[];
}

export class CreateDocumentDto extends DraftFieldsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '請提供文件標題' })
  @Length(1, 200, { message: '文件標題須為 1 至 200 字' })
  title!: string;
}

export class UpdateDocumentDto extends DraftFieldsDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '文件標題必須為文字' })
  @Length(1, 200, { message: '文件標題須為 1 至 200 字' })
  title?: string;
}
