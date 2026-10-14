import { IsIn, IsOptional } from 'class-validator';

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsIn(['created', 'assigned'])
  role?: 'created' | 'assigned';

  @IsOptional()
  @IsIn(['draft', 'active', 'finalizing', 'completed', 'stopped'])
  status?: 'draft' | 'active' | 'finalizing' | 'completed' | 'stopped';
}

export class ListSigningTasksQueryDto {
  @IsOptional()
  @IsIn(['pending', 'signed'])
  status?: 'pending' | 'signed';
}
