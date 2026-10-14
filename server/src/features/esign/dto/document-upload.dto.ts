import { Transform } from 'class-transformer';
import { IsString, Length, ValidateIf } from 'class-validator';

export class CreateDocumentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '請提供文件標題' })
  @Length(1, 200, { message: '文件標題須為 1 至 200 字' })
  title!: string;
}

export class UpdateDocumentDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '文件標題必須為文字' })
  @Length(1, 200, { message: '文件標題須為 1 至 200 字' })
  title?: string;
}
