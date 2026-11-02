import { ApiProperty } from '@nestjs/swagger';
import { OrgDepartmentDto } from '#app/infrastructure/http-client/feastogether/types/org-chart.dto';
import { SignerCandidateResolutionsDto } from './resolve-signer-candidates.dto';

/** 僅描述 interceptor 產生的外層；Controller 不自行包裝。 */
class EmployeeDirectorySuccessDto {
  @ApiProperty({ type: Boolean, enum: [true] }) success!: true;
  @ApiProperty({ type: String, format: 'date-time' }) timestamp!: string;
}

export class SignerCandidateResolutionsResponseDto extends EmployeeDirectorySuccessDto {
  @ApiProperty({ type: SignerCandidateResolutionsDto })
  data!: SignerCandidateResolutionsDto;
}

export class SignerCandidateOrgChartResponseDto extends EmployeeDirectorySuccessDto {
  @ApiProperty({ type: [OrgDepartmentDto] }) data!: OrgDepartmentDto[];
}

export class EmployeeDirectoryErrorDto {
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) message!: string;
}

export class EmployeeDirectoryErrorResponseDto {
  @ApiProperty({ type: Boolean, enum: [false] }) success!: false;
  @ApiProperty({ type: EmployeeDirectoryErrorDto })
  error!: EmployeeDirectoryErrorDto;
  @ApiProperty({ type: String, format: 'date-time' }) timestamp!: string;
}
