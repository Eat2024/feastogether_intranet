import { Type } from 'class-transformer';
import { IsInt, Min, Max } from 'class-validator';

/** 背景發起輕量摘要，不含確認名單或內部租約。 */
export class InitiationJobDto {
  jobId!: string;
  documentId!: string;
  status!: string;
  stage!: string;
  totalCount!: number;
  processedCount!: number;
  attemptCount!: number;
  acceptedAt!: string;
  updatedAt!: string;
  deadlineAt!: string;
  nextAttemptAt!: string | null;
  completedAt!: string | null;
  errorCode!: string | null;
  retryable!: boolean;
  issueCount!: number;
  detailsExpired!: boolean;
  reused?: boolean;
}

/** 問題分頁只接受有界整數，避免無界回傳名單。 */
export class InitiationIssuesQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 100;
}

export class InitiationIssuesDto {
  total!: number;
  items!: {
    inputIndex: number;
    employeeNo?: string;
    code: string;
    message: string;
  }[];
  nextOffset!: number | null;
}
