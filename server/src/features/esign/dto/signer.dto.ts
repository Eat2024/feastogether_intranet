import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
  ValidateBy,
} from 'class-validator';

export class SignerInputDto {
  @ValidateBy({
    name: 'signerIdentityFields',
    validator: {
      validate: (_value, args) => {
        const input = args?.object as SignerInputDto;
        return input.type === 'user'
          ? input.email === undefined && input.name === undefined
          : input.userId === undefined;
      },
    },
  })
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
  @ValidateNested({ each: true })
  @Type(() => SignerInputDto)
  signers!: SignerInputDto[];
}
