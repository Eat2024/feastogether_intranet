import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsUUID,
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
