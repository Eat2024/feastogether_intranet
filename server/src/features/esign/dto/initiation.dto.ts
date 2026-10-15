import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { FieldPlacementDto } from './field.dto';
import { SignerInputDto } from './signer.dto';

export class InitiationFieldDto extends FieldPlacementDto {
  /** 對應本次請求 signers 陣列的索引，不接受其他文件的 publicId。 */
  @IsInt()
  @Min(0)
  @Max(49)
  signerIndex!: number;
}

export class InitiateDocumentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SignerInputDto)
  signers!: SignerInputDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => InitiationFieldDto)
  fields!: InitiationFieldDto[];

  @IsISO8601({ strict: true })
  signStartAt!: string;

  @IsISO8601({ strict: true })
  signEndAt!: string;

  /** 下載／匯出的已簽署 PDF 是否加上浮水印 */
  @IsBoolean()
  watermark!: boolean;

  /** 是否允許簽署人拒絕簽署 */
  @IsBoolean()
  allowReject!: boolean;
}
