import { ExportJobRepository } from '#app/features/esign/repositories/export-job.repository';
// mysql.module.ts
import { Module } from '@nestjs/common';
import { OauthIdentityRepository } from '#app/features/auth/repositories/oauth-identity.repository';
import { AuthSessionRepository } from '#app/features/auth/repositories/auth-session.repository';
import { AuditEventRepository } from '#app/features/esign/repositories/audit-event.repository';
import { SignatureRecordRepository } from '#app/features/esign/repositories/signature-record.repository';
import { VerificationRecordRepository } from '#app/features/esign/repositories/verification-record.repository';
import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { DocumentFieldRepository } from '#app/features/esign/repositories/document-field.repository';
import { FileObjectRepository } from '#app/features/esign/repositories/file-object.repository';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlLifecycleService } from './mysql-lifecycle.service';
import { MysqlProvider } from './mysql.provider';
import { MysqlService } from './mysql.service';

const repositories = [
  ExportJobRepository,
  UserRepository,
  OauthIdentityRepository,
  AuthSessionRepository,
  AuditEventRepository,
  SignatureRecordRepository,
  VerificationRecordRepository,
  DocumentRepository,
  SignerRepository,
  DocumentFieldRepository,
  FileObjectRepository,
  NotificationRepository,
];

@Module({
  providers: [
    MysqlProvider,
    // app.close() 時銷毀連線池；MYSQL_MAIN 本身是普通物件，不會被 Nest 呼叫生命週期
    MysqlLifecycleService,
    MysqlService,
    ...repositories,
  ],
  exports: [MysqlProvider, MysqlService, ...repositories],
})
export class MysqlModule {}
