import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  ValidateNested,
} from 'class-validator';
import { FieldPlacementDto } from './field.dto';
import { SignerInputDto } from './signer.dto';

export class InitiateDocumentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SignerInputDto)
  signers!: SignerInputDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FieldPlacementDto)
  fields!: FieldPlacementDto[];

  @IsISO8601({ strict: true })
  signStartAt!: string;

  @IsISO8601({ strict: true })
  signEndAt!: string;

  /** 浮水印選項快照；正式發起時保存文件設定 */
  @IsBoolean()
  watermark!: boolean;

  /** 拒簽選項快照；正式發起時保存文件設定 */
  @IsBoolean()
  allowReject!: boolean;
}
