import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';
import { EsignInitiationService } from '#app/features/esign/services/esign-initiation.service';
import { EsignEmployeeEmailService } from '#app/features/esign/services/esign-employee-email.service';
import { EsignSignerService } from '#app/features/esign/services/esign-signer.service';
import { EsignFieldService } from '#app/features/esign/services/esign-field.service';
import { EsignConsentService } from '#app/features/esign/services/esign-consent.service';
import { EsignJobProducerService } from '#app/features/esign/services/esign-job-producer.service';
import { DocumentInitiationProcessor } from './document-initiation.processor';
import { DocumentExportProcessor } from './document-export.processor';
import { Module } from '@nestjs/common';
import { EsignQueueModule } from '#app/features/esign/esign-queue.module';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { CompletedPdfService } from '#app/features/esign/services/completed-pdf.service';
import { EsignDocumentValidationService } from '#app/features/esign/services/esign-document-validation.service';
import { PdfValidationService } from '#app/features/esign/services/pdf-validation.service';
import { EsignAccessPolicyService } from '#app/features/esign/services/esign-access-policy.service';
import { EsignStoppageService } from '#app/features/esign/services/esign-stoppage.service';
import { EsignExpiryService } from '#app/features/esign/services/esign-expiry.service';
import { EsignVerificationService } from '#app/features/esign/services/esign-verification.service';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { FileStorageModule } from '#app/infrastructure/file-storage/file-storage.module';
import { LoggingModule } from '#app/infrastructure/logging/logging.module';
import { MailModule } from '#app/infrastructure/mail/mail.module';
import { EsignMaintenanceProcessor } from './esign-maintenance.processor';
import { EsignMaintenanceScheduler } from './esign-maintenance.scheduler';
import { ExternalInvitationProcessor } from './external-invitation.processor';
import { DocumentFinalizationProcessor } from './document-finalization.processor';

@Module({
  imports: [
    MysqlModule,
    FileStorageModule,
    LoggingModule,
    MailModule,
    EsignQueueModule.register('worker'),
  ],
  providers: [
    DocumentInitiationProcessor,
    EsignInitiationJobService,
    EsignInitiationService,
    EsignEmployeeEmailService,
    EsignSignerService,
    EsignFieldService,
    EsignConsentService,
    EsignJobProducerService,

    DocumentExportProcessor,
    EsignTokenService,
    EsignAuditService,
    EsignDocumentValidationService,
    EsignAccessPolicyService,
    EsignStoppageService,
    EsignExpiryService,
    PdfValidationService,
    CompletedPdfService,
    EsignVerificationService,
    ExternalInvitationProcessor,
    DocumentFinalizationProcessor,
    EsignMaintenanceProcessor,
    EsignMaintenanceScheduler,
  ],
})
export class EsignWorkerModule {}
