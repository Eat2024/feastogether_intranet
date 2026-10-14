import type { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import type { SignerInputDto } from '../dto/signer.dto';
import type { EsignSigner } from '../entities/esign-signer.entity';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';

/** 草稿簽署人管理與 Email 正規化。 */
@Injectable()
export class EsignSignerService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly users: UserRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
  ) {}

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async replace(
    documentId: number,
    creatorUserId: number,
    inputs: SignerInputDto[],
  ) {
    if (inputs.length < 1 || inputs.length > 50) {
      throw this.invalid('簽署人數量必須介於 1 至 50 人');
    }

    return this.mysql.transaction((manager) =>
      this.replaceInTransaction(documentId, creatorUserId, inputs, manager),
    );
  }

  /** 沿用呼叫端交易；發起流程不得另開交易。 */
  async replaceInTransaction(
    documentId: number,
    creatorUserId: number,
    inputs: SignerInputDto[],
    manager: EntityManager,
  ) {
    if (inputs.length < 1 || inputs.length > 50)
      throw this.invalid('簽署人數量必須介於 1 至 50 人');

    const document = await this.documents.findByIdForUpdate(
      documentId,
      manager,
    );
    this.access.checkEsignCreator(document, creatorUserId);
    this.validation.checkStillDraft(document);

    const seenUsers = new Set<number>();
    const seenEmails = new Set<string>();
    const replacements: EsignSigner[] = [];

    for (const [index, input] of inputs.entries()) {
      if (input.type === 'user') {
        if (!input.userId || input.name || input.email) {
          throw this.invalid('內部簽署人資料格式不正確');
        }
        const userId = Number(input.userId);
        if (
          !Number.isSafeInteger(userId) ||
          userId < 1 ||
          seenUsers.has(userId)
        ) {
          throw this.invalid('內部簽署人不可重複');
        }
        const user = await this.users.findById(userId, manager);
        if (!user || !user.isActive || user.deletedAt) {
          throw this.invalid('指定的內部簽署人不存在或已停用');
        }
        seenUsers.add(userId);
        replacements.push(
          this.signers.create(
            {
              publicId: randomUUID(),
              documentId,
              signerType: 'user',
              userId,
              empidSnapshot: user.empid,
              nameSnapshot: user.name,
              departmentSnapshot: user.departmentName,
              titleSnapshot: user.titleName,
              status: 'pending',
              sortOrder: index,
              createdByUserId: creatorUserId,
              updatedByUserId: creatorUserId,
            },
            manager,
          ),
        );
        continue;
      }

      if (
        input.type !== 'email' ||
        input.userId ||
        !input.name ||
        !input.email
      ) {
        throw this.invalid('外部簽署人資料格式不正確');
      }
      const email = this.normalizeEmail(input.email);
      const name = input.name.trim();
      if (
        name.length < 1 ||
        name.length > 100 ||
        email.length > 255 ||
        !isEmail(email) ||
        seenEmails.has(email)
      ) {
        throw this.invalid('外部簽署人姓名或 Email 不正確或重複');
      }
      seenEmails.add(email);
      replacements.push(
        this.signers.create(
          {
            publicId: randomUUID(),
            documentId,
            signerType: 'email',
            email,
            nameSnapshot: name,
            status: 'pending',
            sortOrder: index,
            createdByUserId: creatorUserId,
            updatedByUserId: creatorUserId,
          },
          manager,
        ),
      );
    }

    // 欄位 FK 指向簽署人，取代簽署人時必須一併清空草稿欄位。
    await this.fields.deleteDraftFields(documentId, manager);
    await this.signers.deleteDraftSigners(documentId, manager);
    return this.signers.saveMany(replacements, manager);
  }

  private invalid(message: string): AppException {
    return new AppException(
      AppErrorCode.INVALID_REQUEST,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
