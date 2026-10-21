import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';

export class ResolveSignerCandidatesDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 100,
    description: '完整員編，1–20 碼 ASCII 英數字串，保留前導零',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(/^[A-Za-z0-9]{1,20}$/, { each: true })
  employeeNos!: string[];
}

export class SignerCandidateResolutionDto {
  @ApiProperty() employeeNo!: string;
  @ApiProperty({ type: String, nullable: true }) userId!: string | null;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: String, nullable: true }) department!: string | null;
  @ApiProperty({ type: String, nullable: true }) title!: string | null;
  @ApiProperty({ enum: ['resolved', 'unavailable'] }) status!:
    | 'resolved'
    | 'unavailable';
}

export class SignerCandidateResolutionsDto {
  @ApiProperty({ type: [SignerCandidateResolutionDto] })
  items!: SignerCandidateResolutionDto[];
}
