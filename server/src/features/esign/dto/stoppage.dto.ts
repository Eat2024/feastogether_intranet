import { IsString, Length } from 'class-validator';

export class StopDocumentDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}
