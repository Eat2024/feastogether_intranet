import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class SignerInputDto {
  @IsIn(['user', 'email'])
  type!: 'user' | 'email';

  @ValidateIf((input: SignerInputDto) => input.type === 'user')
  @IsString()
  @Matches(/^[1-9][0-9]*$/)
  userId?: string;

  @ValidateIf((input: SignerInputDto) => input.type === 'email')
  @IsString()
  @Length(1, 100)
  name?: string;

  @ValidateIf((input: SignerInputDto) => input.type === 'email')
  @IsEmail()
  @Length(3, 255)
  email?: string;
}

export class ReplaceSignersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SignerInputDto)
  signers!: SignerInputDto[];
}
