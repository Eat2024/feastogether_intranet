import { IsOptional, IsString, Length } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  @Length(1, 200)
  title!: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;
}
