import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SignatureInputDto {
  @IsString()
  @Matches(/^[1-9][0-9]*$/)
  fieldId!: string;

  @IsString()
  @MaxLength(400_000)
  @Matches(/^data:image\/png;base64,/)
  pngDataUrl!: string;
}

export class SignatureSubmissionDto {
  @IsUUID('4')
  requestId!: string;

  @IsString()
  @Length(1, 50)
  consentVersion!: string;

  @Equals(true)
  accepted!: true;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SignatureInputDto)
  signatures!: SignatureInputDto[];
}
