import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';

export class EmployeeEmailCheckDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 6000,
    description: '所選員工本機 ID；正整數字串，不接受員編或信箱覆寫',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6000)
  @IsString({ each: true })
  @Matches(/^[1-9][0-9]*$/, { each: true })
  userIds!: string[];
}
