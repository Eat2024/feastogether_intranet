export const ESIGN_EXTERNAL_INVITATION_QUEUE = 'esign-external-invitation';
export const ESIGN_DOCUMENT_FINALIZATION_QUEUE = 'esign-document-finalization';
export const ESIGN_MAINTENANCE_QUEUE = 'esign-maintenance';

export const ESIGN_EXTERNAL_INVITATION_JOB = 'deliver-external-invitation';
export const ESIGN_DOCUMENT_FINALIZATION_JOB = 'finalize-document';
export const ESIGN_MAINTENANCE_JOB = 'reconcile-esign-work';

export const ESIGN_EXPORT_QUEUE = 'esign-export';

/** API 受理與 maintenance 補列共用同一份去重／保留協定。 */
export const exportJobArguments = (exportJobId: number) =>
  [
    'export',
    { exportJobId },
    {
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
      deduplication: { id: `export-${exportJobId}` },
    },
  ] as const;

/** 背景發起專用 queue 與工作名稱。 */
export const ESIGN_DOCUMENT_INITIATION_QUEUE = 'esign-document-initiation';
export const ESIGN_DOCUMENT_INITIATION_JOB = 'esign-document-initiation';
