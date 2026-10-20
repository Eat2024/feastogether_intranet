import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsUUID,
  IsOptional,
  IsInt,
  Min,
  Max,
  Matches,
  ValidateIf,
} from 'class-validator';
export class NotificationBatchDto {
  @IsUUID('4')
  requestId!: string;

  @IsIn(['selected', 'all_pending'])
  selection!: 'selected' | 'all_pending';

  @ValidateIf(
    (o: NotificationBatchDto) =>
      o.selection === 'selected' || o.signerPublicIds !== undefined,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(6000)
  @IsUUID('4', { each: true })
  signerPublicIds?: string[];
}

export class NotificationPageDto {
  @IsOptional()
  @Matches(/^[1-9][0-9]{0,18}$/)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
export class NotificationListDto extends NotificationPageDto {
  @IsOptional()
  @IsIn(['invitation', 'reminder'])
  kind?: 'invitation' | 'reminder';
}
