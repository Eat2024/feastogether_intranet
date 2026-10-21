import { Injectable } from '@nestjs/common';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { SignatureRecordRepository } from '../repositories/signature-record.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignConsentService } from './esign-consent.service';
import { EsignViewMapper } from './esign-view.mapper';

@Injectable()
export class EsignSigningTaskService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly consent: EsignConsentService,
    private readonly mapper: EsignViewMapper,
    private readonly users: UserRepository,
    private readonly records: SignatureRecordRepository,
  ) {}

  async list(userId: number, status?: 'pending' | 'signed' | 'rejected') {
    const now = new Date();
    const manager = this.mysql.getManager();
    const signers = await this.signers.findAssignedToUser(userId, manager);
    const filtered = status
      ? signers.filter((signer) => signer.status === status)
      : signers;
    const tasks: Array<Awaited<ReturnType<EsignSigningTaskService['toTask']>>> =
      [];
    for (const signer of filtered) {
      const document = await this.documents.findById(
        signer.documentId,
        manager,
      );
      if (!document || document.status === 'draft') continue;
      tasks.push(await this.toTask(document, signer, manager, now));
    }
    return tasks;
  }

  async open(signerPublicId: string, userId: number) {
    return this.mysql.transaction(async (manager) => {
      const candidate = await this.signers.findByPublicId(
        signerPublicId,
        manager,
      );
      const document = candidate
        ? await this.documents.findByIdForUpdate(candidate.documentId, manager)
        : null;
      const signer = document
        ? await this.signers.findByPublicIdForUpdate(signerPublicId, manager)
        : null;
      if (!document || !signer) {
        this.access.checkEsignCreator(null, userId);
        throw new Error('unreachable');
      }
      this.access.assertInternalSigner(document, signer, userId);
      throw new AppException(...AppErrors.ESIGN_EMAIL_OTP_REQUIRED);
    });
  }

  async source(
    signerPublicId: string,
    userId: number,
  ): Promise<{ bytes: Buffer; fileName: string } | null> {
    const manager = this.mysql.getManager();
    const signer = await this.signers.findByPublicId(signerPublicId, manager);
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    if (!document || !signer) {
      this.access.checkEsignCreator(null, userId);
      throw new Error('unreachable');
    }
    this.access.assertInternalSigner(document, signer, userId);
    throw new AppException(...AppErrors.ESIGN_EMAIL_OTP_REQUIRED);
  }

  private async toTask(
    document: NonNullable<Awaited<ReturnType<DocumentRepository['findById']>>>,
    signer: NonNullable<
      Awaited<ReturnType<SignerRepository['findByPublicId']>>
    >,
    manager = this.mysql.getManager(),
    now = new Date(),
  ) {
    const [totals, allFields, creator, record] = await Promise.all([
      this.signers.completionCounts(document.id, manager),
      this.fields.findByDocument(document.id, manager),
      this.users.findById(document.createdByUserId, manager),
      signer.status === 'signed'
        ? this.records.findBySignerId(signer.id, manager)
        : null,
    ]);
    const counts = {
      pendingCount: totals.pending,
      signedCount: totals.signed,
    };
    return {
      signerPublicId: signer.publicId,
      allowReject: document.allowReject,
      // 內部簽署人可看到簽署期間與發起人（外部簽署人的任務另由 external-access 裁切）
      document: this.mapper.documentListItem(
        document,
        counts,
        creator ?? undefined,
        now,
      ),
      signer: this.mapper.signer(signer, null, record?.verificationCode),
      fields: allFields.map((field) => this.mapper.field(field)),
      consent: this.consent.getActive(),
      ...counts,
    };
  }
}
