import type { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import type { SignerInputDto } from '../dto/signer.dto';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
import { invalidRequest } from '../helpers/esign-errors';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';

/** 已通過格式驗證：內部為數字 userId，外部為正規化後的姓名與 Email。 */
type ValidatedSignerInput =
  | { type: 'user'; userId: number }
  | { type: 'email'; name: string; email: string };

/** 內部輸入已附上有效的本地 User；外部輸入維持姓名與 Email。 */
type SignerInputWithUser =
  | { type: 'user'; userId: number; user: User }
  | { type: 'email'; name: string; email: string };

/** 草稿簽署人管理與 Email 正規化。 */
@Injectable()
export class EsignSignerService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly users: UserRepository,
    private readonly access: EsignAccessPolicyService,
  ) { }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async draftSave(
    documentId: number,
    creatorUserId: number,
    inputs: SignerInputDto[],
  ) {
    return this.mysql.transaction(async (manager) => {
      const document = await this.access.checkAndLockDraftDoc(
        documentId,
        creatorUserId,
        manager,
      );
      return this.updateSigners(document, creatorUserId, inputs, manager);
    });
  }

  /**
   * 沿用呼叫端交易，整批替換草稿簽署人。
   * 呼叫端必須先在同一 manager 內鎖定 document，並驗證建立人與草稿狀態。
   */
  async updateSigners(
    document: EsignDocument,
    creatorUserId: number,
    inputs: SignerInputDto[],
    manager: EntityManager,
  ) {
    const validatedSignerInputs = this.validateAndNormalizeSignerInputs(inputs);
    const signerInputsWithUsers = await this.attachValidatedUsers(
      validatedSignerInputs,
      manager,
    );
    const newSigners = this.createSigners(
      document.id,
      creatorUserId,
      signerInputsWithUsers,
      manager,
    );
    return this.saveDraftSigners(
      document.id,
      creatorUserId,
      newSigners,
      manager,
    );
  }

  /** 驗證名單數量、格式與重複資料，並正規化姓名及 Email。 */
  private validateAndNormalizeSignerInputs(
    inputs: SignerInputDto[],
  ): ValidatedSignerInput[] {
    if (inputs.length < 1 || inputs.length > 50)
      throw invalidRequest('簽署人數量必須介於 1 至 50 人');

    const seenUsers = new Set<number>();
    const seenEmails = new Set<string>();
    // 先完成整份名單的格式驗證與去重，再進行資料庫查詢。
    return inputs.map<ValidatedSignerInput>((input) => {
      if (input.type === 'user') {
        const userId = Number(input.userId);
        if (
          !Number.isSafeInteger(userId) ||
          userId < 1 ||
          seenUsers.has(userId)
        ) {
          throw invalidRequest('內部簽署人不可重複');
        }
        seenUsers.add(userId);
        return { type: 'user', userId };
      }

      if (
        input.type !== 'email' ||
        input.userId ||
        !input.name ||
        !input.email
      ) {
        throw invalidRequest('外部簽署人資料格式不正確');
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
        throw invalidRequest('外部簽署人姓名或 Email 不正確或重複');
      }
      seenEmails.add(email);
      return { type: 'email', name, email };
    });
  }

  /** 一次查回公司員工帳號，確認名單上的公司員工帳號仍有效。如果是外部使用者只有email，則只回傳email */
  private async attachValidatedUsers(
    validatedSignerInputs: ValidatedSignerInput[],
    manager: EntityManager,
  ): Promise<SignerInputWithUser[]> {
    const userIds = validatedSignerInputs.flatMap((input) =>
      input.type === 'user' ? [input.userId] : [],
    );
    const users =
      userIds.length > 0 ? await this.users.findByIds(userIds, manager) : [];
    const userById = new Map(users.map((user) => [Number(user.id), user]));
    // 先確認整份名單的帳號仍有效，後續只負責建立簽署人資料。
    return validatedSignerInputs.map((input) => {
      if (input.type === 'email') return input;
      const user = userById.get(input.userId);
      if (!user || !user.isActive || user.deletedAt) {
        throw invalidRequest('指定的內部簽署人不存在或已停用');
      }
      return { ...input, user };
    });
  }

  /** 按原始順序建立簽署人及員工資料快照，尚不寫入資料庫。 */
  private createSigners(
    documentId: number,
    creatorUserId: number,
    signerInputsWithUsers: SignerInputWithUser[],
    manager: EntityManager,
  ): EsignSigner[] {
    return signerInputsWithUsers.map((input, index) => {
      const common = {
        publicId: randomUUID(),
        documentId,
        status: 'pending' as const,
        sortOrder: index,
        createdByUserId: creatorUserId,
        updatedByUserId: creatorUserId,
      };
      if (input.type === 'user') {
        const { user } = input;
        return this.signers.create(
          {
            ...common,
            signerType: 'user',
            userId: input.userId,
            empidSnapshot: user.empid,
            nameSnapshot: user.name,
            departmentSnapshot: user.departmentName,
            titleSnapshot: user.titleName,
          },
          manager,
        );
      }
      return this.signers.create(
        {
          ...common,
          signerType: 'email',
          email: input.email,
          nameSnapshot: input.name,
        },
        manager,
      );
    });
  }

  /** 在同一交易內解除欄位指派，並以新名單替換草稿簽署人。 */
  private async saveDraftSigners(
    documentId: number,
    creatorUserId: number,
    newSigners: EsignSigner[],
    manager: EntityManager,
  ): Promise<EsignSigner[]> {
    // 欄位 FK 指向簽署人；先解除指派再刪舊簽署人，草稿欄位位置保留，待重新指派。
    await this.fields.unassignDraftFields(documentId, creatorUserId, manager);
    await this.signers.deleteDraftSigners(documentId, manager);
    return this.signers.saveMany(newSigners, manager);
  }
}
