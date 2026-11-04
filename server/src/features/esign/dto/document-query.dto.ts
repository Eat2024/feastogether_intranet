import { IsIn, IsOptional } from 'class-validator';

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsIn(['dep', 'created', 'assigned'])
  role?: 'dep' | 'created' | 'assigned';

  @IsOptional()
  @IsIn([
    'initiating',
    'draft',
    'active',
    'expired',
    'finalizing',
    'completed',
    'stopped',
  ])
  status?:
    | 'initiating'
    | 'draft'
    | 'active'
    | 'expired'
    | 'finalizing'
    | 'completed'
    | 'stopped';
}

export class ListSigningTasksQueryDto {
  @IsOptional()
  @IsIn(['pending', 'signed', 'rejected'])
  status?: 'pending' | 'signed' | 'rejected';
}

/** 同一路徑的匯出資料視角，必須另以同部門政策授權。 */
export class ReadDocumentQueryDto {
  @IsOptional()
  @IsIn(['export'])
  view?: 'export';
}
