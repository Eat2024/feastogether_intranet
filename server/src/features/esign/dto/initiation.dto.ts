import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  ValidateNested,
  ValidateIf,
  IsIn,
  IsString,
  IsEmail,
  Length,
  Matches,
  ValidateBy,
} from 'class-validator';
import { FieldPlacementDto } from './field.dto';
/** 僅發起接受員編；草稿 API 沿用既有 signer DTO。 */
export class InitiationSignerInputDto {
  @IsIn(['employee', 'user', 'email'])
  @ValidateBy({
    name: 'initiationIdentity',
    validator: {
      validate: (_value, args) => {
        const value = args?.object as InitiationSignerInputDto;
        if (value.type === 'employee')
          return (
            value.userId === undefined &&
            value.name === undefined &&
            value.email === undefined
          );
        if (value.type === 'user')
          return (
            value.employeeNo === undefined &&
            value.name === undefined &&
            value.email === undefined
          );
        return value.userId === undefined && value.employeeNo === undefined;
      },
    },
  })
  type!: 'employee' | 'user' | 'email';

  @ValidateIf((value: InitiationSignerInputDto) => value.type === 'employee')
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,20}$/)
  employeeNo?: string;

  @ValidateIf((value: InitiationSignerInputDto) => value.type === 'user')
  @IsString()
  @Matches(/^[1-9][0-9]*$/)
  userId?: string;

  @ValidateIf((value: InitiationSignerInputDto) => value.type === 'email')
  @IsString()
  @Length(1, 100)
  name?: string;

  @ValidateIf((value: InitiationSignerInputDto) => value.type === 'email')
  @IsEmail()
  @Length(3, 255)
  email?: string;
}

export class InitiateDocumentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InitiationSignerInputDto)
  signers!: InitiationSignerInputDto[];

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
