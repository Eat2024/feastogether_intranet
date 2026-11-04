import { ApiProperty } from '@nestjs/swagger';
import { InitiationIssuesDto, InitiationJobDto } from './initiation-job.dto';
import { InitiateDocumentDto } from './initiation.dto';

/** 只描述 ResponseInterceptor 外層，不改 Controller 執行回傳。 */
class InitiationSuccessDto {
  @ApiProperty({ type: Boolean, enum: [true] }) success!: true;
  @ApiProperty({ type: String, format: 'date-time' }) timestamp!: string;
}

export class InitiationJobResponseDto extends InitiationSuccessDto {
  @ApiProperty({ type: InitiationJobDto }) data!: InitiationJobDto;
}

export class LatestInitiationJobResponseDto extends InitiationSuccessDto {
  @ApiProperty({ type: InitiationJobDto, nullable: true })
  data!: InitiationJobDto | null;
}

export class InitiationIssuesResponseDto extends InitiationSuccessDto {
  @ApiProperty({ type: InitiationIssuesDto }) data!: InitiationIssuesDto;
}

export class InitiationInputResponseDto extends InitiationSuccessDto {
  @ApiProperty({ type: InitiateDocumentDto }) data!: InitiateDocumentDto;
}
