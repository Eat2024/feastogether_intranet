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
