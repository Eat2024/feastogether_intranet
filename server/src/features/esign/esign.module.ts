import { RedisModule } from '#app/infrastructure/database/redis/redis.module';
import { Module } from '@nestjs/common';
import { FileStorageModule } from '#app/infrastructure/file-storage/file-storage.module';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { LoggingModule } from '#app/infrastructure/logging/logging.module';
import { MailModule } from '#app/infrastructure/mail/mail.module';
import { FeastogetherModule } from '#app/infrastructure/http-client/feastogether/feastogether.module';
import { EsignAccessPolicyService } from './services/esign-access-policy.service';
import { EsignAuditService } from './services/esign-audit.service';
import { EsignConsentService } from './services/esign-consent.service';
import { EsignDocumentValidationService } from './services/esign-document-validation.service';
import { EsignSignerService } from './services/esign-signer.service';
import { EsignSignerCandidateService } from './services/esign-signer-candidate.service';
import { EsignTokenService } from './services/esign-token.service';
import { EsignViewMapper } from './services/esign-view.mapper';
import { PdfValidationService } from './services/pdf-validation.service';
import { EsignDraftService } from './services/esign-draft.service';
import { EsignFieldService } from './services/esign-field.service';
import { EsignInitiationService } from './services/esign-initiation.service';
import { EsignJobProducerService } from './services/esign-job-producer.service';
import { EsignQueueModule } from './esign-queue.module';
import { DocumentsController } from './controllers/documents.controller';
import { SignerCandidatesController } from './controllers/signer-candidates.controller';
import { SigningTasksController } from './controllers/signing-tasks.controller';
import { ExternalSignatureController } from './controllers/external-signature.controller';
import { SignatureVerificationController } from './controllers/signature-verification.controller';
import { EsignDocumentQueryService } from './services/esign-document-query.service';
import { EsignSigningTaskService } from './services/esign-signing-task.service';
import { EsignSigningService } from './services/esign-signing.service';
import { ExternalAccessService } from './services/external-access.service';
import { EsignStoppageService } from './services/esign-stoppage.service';
import { EsignCompletionAccessService } from './services/esign-completion-access.service';
import { EsignVerificationService } from './services/esign-verification.service';

const esignServices = [
  EsignAccessPolicyService,
  EsignAuditService,
  EsignConsentService,
  EsignDocumentValidationService,
  EsignDocumentQueryService,
  EsignDraftService,
  EsignFieldService,
  EsignInitiationService,
  EsignJobProducerService,
  EsignSigningTaskService,
  EsignSigningService,
  ExternalAccessService,
  EsignStoppageService,
  EsignCompletionAccessService,
  EsignSignerService,
  EsignSignerCandidateService,
  EsignTokenService,
  EsignVerificationService,
  EsignViewMapper,
  PdfValidationService,
];

@Module({
  imports: [
    RedisModule,
    MysqlModule,
    FileStorageModule,
    LoggingModule,
    MailModule,
    FeastogetherModule,
    EsignQueueModule.register('producer'),
  ],
  providers: esignServices,
  controllers: [
    DocumentsController,
    SignerCandidatesController,
    SigningTasksController,
    ExternalSignatureController,
    SignatureVerificationController,
  ],
  exports: [...esignServices, EsignQueueModule],
})
export class EsignModule {}
