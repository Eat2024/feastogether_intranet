import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class FieldPlacementDto {
  @IsIn(['signature', 'date'])
  type!: 'signature' | 'date';

  @IsInt()
  @Min(1)
  @Max(100)
  page!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(99.999)
  xPercent!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(99.999)
  yPercent!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(100)
  widthPercent!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(100)
  heightPercent!: number;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class FieldInputDto extends FieldPlacementDto {
  @IsUUID('4')
  signerPublicId!: string;
}

export class ReplaceFieldsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FieldInputDto)
  fields!: FieldInputDto[];
}
