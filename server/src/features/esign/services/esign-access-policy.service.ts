import type { Actor } from '#app/features/auth/auth.types';
import { AuthorizationService } from '#app/features/authorization/services/authorization.service';
import {
  InitiationJobRepository,
  type InitiationLease,
} from '../repositories/initiation-job.repository';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { AppErrors } from '#app/common/errors/app-errors';
import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { AppException } from '#app/common/errors/app.exception';
import { INTERNAL_PORTAL_LOGIN_URL } from '../esign.constants';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { DocumentRepository } from '../repositories/document.repository';
import { EsignDocumentValidationService } from './esign-document-validation.service';

/** 待簽者在簽署開始前存取（409）：JSON 回應帶 details.startAt，邀請頁以 startAt 顯示開始時間。 */
export class SigningNotStartedException extends AppException {
  constructor(readonly startAt: Date) {
    super(...AppErrors.ESIGN_SIGNING_NOT_STARTED(startAt), {
      startAt: startAt.toISOString(),
    });
  }
}

export interface ExternalAccess {
  document: EsignDocument | null;
  signer: EsignSigner | null;
}

type CheckedExternalAccess = { document: EsignDocument; signer: EsignSigner };

@Injectable()
export class EsignAccessPolicyService {
  constructor(
    private readonly documents: EsignDocumentValidationService,
    private readonly documentRepository: DocumentRepository,
    private readonly users: UserRepository,
    private readonly initiationJobs: InitiationJobRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  /** 功能能力與資源範圍分開；只放寬範圍，不放寬文件狀態。 */
  async readableForActor(
    document: EsignDocument | null,
    actor: Actor,
    manager: EntityManager,
  ): Promise<EsignDocument> {
    await this.authorization.requirePermissions(
      actor,
      ['esign.document.read'],
      manager,
    );
    if (!document || document.deletedAt) throw this.notFound();
    if (await this.hasPermission(actor, 'esign.document.read-all', manager))
      return document;
    if (actor.kind !== 'employee') throw this.notFound();
    return this.readableDocument(document, actor.userId, manager);
  }

  async hasPermission(
    actor: Actor,
    permission: import('#app/features/authorization/authorization.catalog').PermissionKey,
    manager: EntityManager,
  ): Promise<boolean> {
    try {
      await this.authorization.requirePermissions(actor, [permission], manager);
      return true;
    } catch (error) {
      if (
        error instanceof AppException &&
        error.code === 'AUTHORIZATION_DENIED'
      )
        return false;
      throw error;
    }
  }

  async manageableDocument(
    document: EsignDocument | null,
    actor: Actor,
    manager: EntityManager,
  ): Promise<EsignDocument> {
    await this.authorization.requirePermissions(
      actor,
      ['esign.document.manage'],
      manager,
    );
    if (!document || document.deletedAt) throw this.notFound();
    if (actor.kind === 'employee' && document.createdByUserId === actor.userId)
      return document;
    if (await this.hasPermission(actor, 'esign.document.manage-all', manager))
      return document;
    throw this.notFound();
  }

  async canManageDocument(
    document: EsignDocument,
    actor: Actor,
    manager: EntityManager,
  ): Promise<boolean> {
    try {
      await this.manageableDocument(document, actor, manager);
      return true;
    } catch (error) {
      if (
        error instanceof AppException &&
        ['AUTHORIZATION_DENIED', 'ESIGN_RESOURCE_NOT_FOUND'].includes(
          error.code,
        )
      )
        return false;
      throw error;
    }
  }

  async assertManagerNotInitiating(
    documentId: number,
    actor: Actor,
    manager: EntityManager,
  ): Promise<void> {
    await this.manageableDocument(
      await this.documentRepository.findById(documentId, manager),
      actor,
      manager,
    );
    const active = await this.initiationJobs.activeIdentity(
      documentId,
      manager,
    );
    if (active)
      throw new AppException(...AppErrors.ESIGN_INITIATION_IN_PROGRESS, {
        existingJobId: active.publicId,
      });
  }

  async lockManagedDraft(
    documentId: number,
    actor: Actor,
    manager: EntityManager,
  ): Promise<EsignDocument> {
    // 先完成授權 current read，再取得文件鎖，避免角色鎖與文件鎖倒置。
    await this.authorization.requirePermissions(
      actor,
      ['esign.document.manage'],
      manager,
    );
    const document = await this.manageableDocument(
      await this.documentRepository.findByIdForUpdate(documentId, manager),
      actor,
      manager,
    );
    this.documents.checkStillDraft(document);
    await this.assertNotInitiating(documentId, manager);
    return document;
  }

  /** 每次從 DB 讀取目前可信部門；建立文件時先鎖員工，避免與登入同步交錯。 */
  async requireDepartment(
    userId: number,
    manager: EntityManager,
    lock = false,
  ): Promise<User & { departmentCode: string }> {
    const user = lock
      ? await this.users.findByIdForUpdate(userId, manager)
      : await this.users.findById(userId, manager);
    this.assertActiveEmployee(user);
    if (!user.departmentCode?.trim()) {
      throw new AppException(...AppErrors.ESIGN_DEPARTMENT_UNAVAILABLE);
    }
    return { ...user, departmentCode: user.departmentCode };
  }

  /** 唯讀資格不放寬任何既有建立人寫入檢查。 */
  async readableDocument(
    document: EsignDocument | null,
    userId: number,
    manager: EntityManager,
  ): Promise<EsignDocument> {
    if (!document || document.deletedAt) throw this.notFound();
    const user = await this.users.findById(userId, manager);
    this.assertActiveEmployee(user);
    if (document.createdByUserId === userId) return document;
    if (!user.departmentCode?.trim()) {
      throw new AppException(...AppErrors.ESIGN_DEPARTMENT_UNAVAILABLE);
    }
    if (document.createdByDepartmentCode !== user.departmentCode)
      throw this.notFound();
    return document;
  }

  /** 一般匯出沒有建立人或原匯出人的跨部門例外。 */
  async checkDepartmentDocument(
    document: EsignDocument | null,
    userId: number,
    manager: EntityManager,
  ): Promise<EsignDocument> {
    const user = await this.requireDepartment(userId, manager);
    if (
      !document ||
      document.deletedAt ||
      document.createdByDepartmentCode !== user.departmentCode
    ) {
      throw this.notFound();
    }
    return document;
  }

  /** 僅供 UI 呈現能力；實際匯出仍必須重新授權。 */
  async canExportDocument(
    document: EsignDocument,
    userId: number,
    manager: EntityManager,
  ): Promise<boolean> {
    const user = await this.users.findById(userId, manager);
    this.assertActiveEmployee(user);
    return (
      !document.deletedAt &&
      !!user.departmentCode?.trim() &&
      document.createdByDepartmentCode === user.departmentCode
    );
  }

  private assertActiveEmployee(user: User | null): asserts user is User {
    if (!user || !user.isActive || user.deletedAt) throw this.notFound();
  }

  /**
   * 沿用呼叫端交易，以悲觀鎖鎖定文件並驗證建立人與草稿狀態。
   * 鎖定持續到交易結束，期間其他請求無法發起、刪除或修改此文件。
   */
  async checkAndLockDraftDoc(
    documentId: number,
    userId: number,
    manager: EntityManager,
    lease?: InitiationLease,
  ): Promise<EsignDocument> {
    const document = await this.documentRepository.findByIdForUpdate(
      documentId,
      manager,
    );
    this.checkEsignDraftCreator(document, userId);
    await this.assertNotInitiating(documentId, manager, lease);
    return document;
  }

  /** 交易外先授權再快拒忙碌；不可在 RR 交易內先建立普通讀快照。 */
  async assertCreatorNotInitiating(
    documentId: number,
    userId: number,
    manager: EntityManager,
  ): Promise<void> {
    const document = await this.documentRepository.findInitiationAccess(
      documentId,
      manager,
    );
    this.checkEsignCreator(document, userId);
    const active = await this.initiationJobs.activeIdentity(
      documentId,
      manager,
    );
    if (active)
      throw new AppException(
        ...AppErrors.ESIGN_INITIATION_IN_PROGRESS,
        active ? { existingJobId: active.publicId } : undefined,
      );
  }

  /** 必須由已授權且持有文件鎖的呼叫端使用，確保競態 current read。 */
  async assertNotInitiating(
    documentId: number,
    manager: EntityManager,
    lease?: InitiationLease,
  ): Promise<void> {
    if (!lease) {
      const active = await this.initiationJobs.activeIdentity(
        documentId,
        manager,
        true,
      );
      if (active)
        throw new AppException(...AppErrors.ESIGN_INITIATION_IN_PROGRESS, {
          existingJobId: active.publicId,
        });
      return;
    }
    const active = await this.initiationJobs.active(documentId, manager);
    if (
      !active ||
      active.id !== lease.jobId ||
      active.status !== 'processing' ||
      active.leaseToken !== lease.leaseToken ||
      !active.leaseExpiresAt ||
      active.leaseExpiresAt <= new Date()
    ) {
      throw new AppException(
        ...AppErrors.ESIGN_INITIATION_IN_PROGRESS,
        active ? { existingJobId: active.publicId } : undefined,
      );
    }
    if (active.deadlineAt <= new Date())
      throw new AppException(...AppErrors.ESIGN_INITIATION_PROCESSING_TIMEOUT);
    const version = await this.initiationJobs.version(documentId, manager);
    const expected = active.documentVersionJson;
    if (
      !version ||
      !expected ||
      version.updatedAt !== expected.updatedAt ||
      version.sourceFileId !== expected.sourceFileId ||
      version.sourceSha256 !== expected.sourceSha256 ||
      version.sourceObjectVersion !== expected.sourceObjectVersion
    )
      throw new AppException(...AppErrors.ESIGN_INITIATION_DOCUMENT_CHANGED);
  }

  /** 驗證已讀取的文件屬於建立人且仍為草稿，不查詢或取得鎖定。 */
  checkEsignDraftCreator(
    document: EsignDocument | null,
    userId: number,
  ): asserts document is EsignDocument {
    this.checkEsignCreator(document, userId);
    this.documents.checkStillDraft(document);
  }

  checkEsignCreator(
    document: EsignDocument | null,
    userId: number,
  ): asserts document is EsignDocument {
    if (
      document === null ||
      document.createdByUserId !== userId ||
      document.deletedAt
    ) {
      throw this.notFound();
    }
  }

  assertInternalSigner(
    document: EsignDocument,
    signer: EsignSigner,
    userId: number,
  ): void {
    if (
      document.status === 'draft' ||
      signer.signerType !== 'user' ||
      signer.userId !== userId ||
      signer.documentId !== document.id ||
      signer.deletedAt ||
      document.deletedAt
    ) {
      throw this.notFound();
    }
  }

  assertCreatorOrSignedInternalSigner(
    document: EsignDocument | null,
    signer: EsignSigner | null,
    userId: number,
  ): asserts document is EsignDocument {
    if (
      document &&
      !document.deletedAt &&
      (document.createdByUserId === userId ||
        (signer?.signerType === 'user' &&
          signer.userId === userId &&
          signer.documentId === document.id &&
          signer.status === 'signed' &&
          !signer.deletedAt))
    ) {
      return;
    }
    throw this.notFound();
  }

  /**
   * 外部存取（寄送與驗證驗證碼、開啟任務、讀原始 PDF、下載本人副本、重送同一次簽名）。
   * 呼叫端以邀請 token 或存取憑證找出簽署人；共同條件：固定有效信箱及邀請世代、屬於該文件、簽署人與文件未刪除。
   * 已簽／已拒者不比對期限、文件狀態與簽署期間；待簽者須在邀請期限與有效簽署期間內。
   * 已拒者僅可讀結果／重送同一次拒簽；來源與副本端點另行拒絕。
   * 待簽者在簽署開始前回 409 告知開始時間；其餘失敗一律回通用 401，不區分原因。
   */
  assertExternalAccess(
    access: ExternalAccess,
    now: Date,
  ): asserts access is CheckedExternalAccess {
    const { document, signer } = access;
    // 憑證已定位到尚存在的內部指派，只提供固定入口；不授權 OTP 讀檔或操作。
    if (
      signer?.signerType === 'user' &&
      document &&
      signer.documentId === document.id &&
      !signer.deletedAt &&
      !document.deletedAt
    ) {
      throw new AppException(...AppErrors.ESIGN_INTERNAL_LOGIN_REQUIRED, {
        portalLoginUrl: INTERNAL_PORTAL_LOGIN_URL,
      });
    }
    const valid =
      signer !== null &&
      document !== null &&
      signer.signerType === 'email' &&
      typeof signer.email === 'string' &&
      isEmail(signer.email) &&
      typeof signer.invitationTokenSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(signer.invitationTokenSha256) &&
      signer.documentId === document.id &&
      !signer.deletedAt &&
      !document.deletedAt;
    if (!valid) throw this.externalUnauthorized();
    if (signer.status === 'signed' || signer.status === 'rejected') return;
    this.assertPendingInvitation(document, signer, now);
  }

  /** 送出新簽名：先通過外部存取，且必須是待簽者 */
  assertExternalInvitation(
    access: ExternalAccess,
    now: Date,
  ): asserts access is CheckedExternalAccess {
    this.assertExternalAccess(access, now);
    if (access.signer.status !== 'pending') throw this.externalUnauthorized();
  }

  private assertPendingInvitation(
    document: EsignDocument,
    signer: EsignSigner,
    now: Date,
  ): void {
    if (
      signer.status !== 'pending' ||
      signer.invitationExpiresAt == null ||
      now >= signer.invitationExpiresAt
    ) {
      throw this.externalUnauthorized();
    }
    this.assertSigningStarted(document, now);
    try {
      this.documents.assertActiveSigningWindow(document, now);
    } catch {
      throw this.externalUnauthorized();
    }
  }

  /**
   * 呼叫端須先確認憑證有效且簽署人待簽：簽署中但尚未到開始時間時告知開始時間；
   * 其他期間外情況交由簽署期間檢查，維持通用失效。
   */
  private assertSigningStarted(document: EsignDocument, now: Date): void {
    const startAt = document.signStartAt;
    if (document.status === 'active' && startAt && now < startAt) {
      throw new SigningNotStartedException(startAt);
    }
  }

  private notFound(): AppException {
    return new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
  }

  private externalUnauthorized(): AppException {
    return new AppException(...AppErrors.ESIGN_EXTERNAL_UNAUTHORIZED);
  }
}
