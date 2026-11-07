import type { EsignExportJob } from '../entities/esign-export-job.entity';
import type { ExportedByDto } from '../dto/export-history.dto';

/** 只輸出持久化操作者的顯示欄位，NULL 員工不代表外部簽署人。 */
export function exportActorView(record: EsignExportJob): ExportedByDto {
  if (record.createdByActorKind === 'super_user')
    return {
      kind: 'super_user',
      name: 'Super user',
      employeeNo: null,
      email: null,
    };
  if (record.createdByActorKind === 'external_signer')
    return {
      kind: 'external_signer',
      name: record.signer?.nameSnapshot ?? '',
      employeeNo: null,
      email: record.signer?.email ?? null,
    };
  return {
    kind: 'employee',
    name: record.createdByUser?.name ?? '',
    employeeNo: record.createdByUser?.empid ?? null,
    email: null,
  };
}
