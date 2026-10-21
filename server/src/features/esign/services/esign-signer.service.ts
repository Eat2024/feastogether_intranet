import { DraftSettingsDto } from '../dto/draft-settings.dto';
import { DocumentRepository } from '../repositories/document.repository';
import { AppErrors } from '#app/common/errors/app-errors';
import type { EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isEmail, isISO8601 } from 'class-validator';
import { AppException } from '#app/common/errors/app.exception';
import type { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import type { SignerInputDto } from '../dto/signer.dto';
import type { EsignDocument } from '../entities/esign-document.entity';
import type { EsignSigner } from '../entities/esign-signer.entity';
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

interface DraftSigningPeriod {
  signStartAt: Date | null;
  signEndAt: Date | null;
}

/** 草稿簽署人管理與 Email 正規化。 */
@Injectable()
export class EsignSignerService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly signers: SignerRepository,
    private readonly users: UserRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly documents: DocumentRepository,
  ) {}

  async saveNote(
    documentId: number,
    signerPublicId: string,
    userId: number,
    input: unknown,
  ) {
    if (typeof input !== 'string' || Array.from(input.trim()).length > 30) {
      throw new AppException(...AppErrors.ESIGN_SIGNER_NOTE_INVALID);
    }
    const note = input.trim();
    return this.mysql.transaction(async (manager) => {
      // 與簽署、停止及名單變更使用相同鎖順序；不修改文件或簽署證據。
      const document = await this.documents.findByIdForUpdate(
        documentId,
        manager,
      );
      this.access.checkEsignCreator(document, userId);
      const signer = await this.signers.findByPublicIdForUpdate(
        signerPublicId,
        manager,
      );
      if (!signer || signer.documentId !== documentId) {
        throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
      }
      signer.note = note;
      signer.updatedByUserId = userId;
      await this.signers.save(signer, manager);
      return { signerPublicId: signer.publicId, note };
    });
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async draftSave(
    documentId: number,
    creatorUserId: number,
    input: DraftSettingsDto,
  ) {
    return this.saveDraftSettings(documentId, creatorUserId, input);
  }

  async saveDraftSettings(
    documentId: number,
    creatorUserId: number,
    input: DraftSettingsDto,
  ) {
    return this.mysql.transaction(async (manager) => {
      const document = await this.access.checkAndLockDraftDoc(
        documentId,
        creatorUserId,
        manager,
      );
      const period = this.resolveDraftSigningPeriod(document, input);
      this.validateDraftOptions(input);
      await this.updateDraftSignersIfProvided(
        document,
        creatorUserId,
        input,
        manager,
      );
      this.applyDraftSettings(document, input, period);
      return this.documents.save(document, manager);
    });
  }

  /** 依省略保留、null 清空規則解析期間，並驗證開始時間早於結束時間。 */
  private resolveDraftSigningPeriod(
    document: EsignDocument,
    input: DraftSettingsDto,
  ): DraftSigningPeriod {
    const signStartAt = this.parseDraftDate(
      input.signStartAt,
      document.signStartAt ?? null,
    );
    const signEndAt = this.parseDraftDate(
      input.signEndAt,
      document.signEndAt ?? null,
    );
    if (signStartAt && signEndAt && signStartAt >= signEndAt) {
      throw new AppException(...AppErrors.ESIGN_SIGNING_PERIOD_INVALID);
    }
    return { signStartAt, signEndAt };
  }

  /** 解析單一草稿日期；未傳沿用舊值，null 清空，有值時必須包含時區。 */
  private parseDraftDate(
    value: string | null | undefined,
    previous: Date | null,
  ): Date | null {
    if (value === undefined) return previous;
    if (value === null) return null;
    if (
      typeof value !== 'string' ||
      !isISO8601(value, { strict: true }) ||
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(new Date(value).getTime())
    ) {
      throw new AppException(...AppErrors.ESIGN_SIGNING_PERIOD_INVALID);
    }
    return new Date(value);
  }

  /** 驗證可選的草稿布林設定，避免非 HTTP 呼叫端繞過 DTO 驗證。 */
  private validateDraftOptions(input: DraftSettingsDto): void {
    if (
      (input.watermark !== undefined &&
        typeof input.watermark !== 'boolean') ||
      (input.allowReject !== undefined &&
        typeof input.allowReject !== 'boolean')
    ) {
      throw new AppException(...AppErrors.ESIGN_DRAFT_OPTIONS_INVALID);
    }
  }

  /** 有帶名單時才在目前交易內整批替換，省略時保留既有簽署人。 */
  private async updateDraftSignersIfProvided(
    document: EsignDocument,
    creatorUserId: number,
    input: DraftSettingsDto,
    manager: EntityManager,
  ): Promise<void> {
    if (input.signers === undefined) return;
    await this.updateSigners(
      document,
      creatorUserId,
      input.signers,
      manager,
    );
  }

  /** 將已驗證的期間與有傳入的選項套用到草稿文件。 */
  private applyDraftSettings(
    document: EsignDocument,
    input: DraftSettingsDto,
    period: DraftSigningPeriod,
  ): void {
    document.signStartAt = period.signStartAt;
    document.signEndAt = period.signEndAt;
    if (input.watermark !== undefined) {
      document.watermarkEnabled = input.watermark;
    }
    if (input.allowReject !== undefined) {
      document.allowReject = input.allowReject;
    }
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
    return this.saveDraftSigners(document.id, newSigners, manager);
  }

  /** 驗證名單數量、格式與重複資料，並正規化姓名及 Email。 */
  private validateAndNormalizeSignerInputs(
    inputs: SignerInputDto[],
  ): ValidatedSignerInput[] {
    if (!Array.isArray(inputs) || inputs.length < 1)
      throw new AppException(...AppErrors.ESIGN_SIGNER_REQUIRED);

    const seenUsers = new Set<number>();
    const seenEmails = new Set<string>();
    // 先完成整份名單的格式驗證與去重，再進行資料庫查詢。
    return inputs.map<ValidatedSignerInput>((input) => {
      if (input.type === 'user') {
        if (input.email !== undefined || input.name !== undefined)
          throw new AppException(...AppErrors.ESIGN_EXTERNAL_SIGNER_INVALID);
        const userId = Number(input.userId);
        if (
          !Number.isSafeInteger(userId) ||
          userId < 1 ||
          seenUsers.has(userId)
        ) {
          throw new AppException(...AppErrors.ESIGN_INTERNAL_SIGNER_DUPLICATE);
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
        throw new AppException(...AppErrors.ESIGN_EXTERNAL_SIGNER_INVALID);
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
        throw new AppException(
          ...AppErrors.ESIGN_EXTERNAL_SIGNER_IDENTITY_INVALID,
        );
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
    const users: User[] = [];
    for (let offset = 0; offset < userIds.length; offset += 500) {
      users.push(
        ...(await this.users.findByIds(
          userIds.slice(offset, offset + 500),
          manager,
        )),
      );
    }
    const userById = new Map(users.map((user) => [Number(user.id), user]));
    // 先確認整份名單的帳號仍有效，後續只負責建立簽署人資料。
    return validatedSignerInputs.map((input) => {
      if (input.type === 'email') return input;
      const user = userById.get(input.userId);
      if (!user || !user.isActive || user.deletedAt) {
        throw new AppException(...AppErrors.ESIGN_INTERNAL_SIGNER_UNAVAILABLE);
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

  /** 同一交易替換草稿名單，共用欄位不隨名單變更。 */
  private async saveDraftSigners(
    documentId: number,
    newSigners: EsignSigner[],
    manager: EntityManager,
  ): Promise<EsignSigner[]> {
    await this.signers.deleteDraftSigners(documentId, manager);
    return this.signers.saveMany(newSigners, manager);
  }
}
