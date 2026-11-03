import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import {
  InitiationJobRepository,
  type InitiationLease,
} from '../repositories/initiation-job.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { type InitiateDocumentDto } from '../dto/initiation.dto';
import { type InitiationJobDto } from '../dto/initiation-job.dto';
import { type EsignInitiationJob } from '../entities/esign-initiation-job.entity';
import { type SignerInputDto } from '../dto/signer.dto';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { canonicalSha256 } from './esign-audit.service';
import { EsignInitiationService } from './esign-initiation.service';
import { EsignJobProducerService } from './esign-job-producer.service';

@Injectable()
export class EsignInitiationJobService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly jobs: InitiationJobRepository,
    private readonly documents: DocumentRepository,
    private readonly users: UserRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly initiation: EsignInitiationService,
    private readonly producer: EsignJobProducerService,
  ) {}

  async accept(
    documentId: number,
    userId: number,
    body: InitiateDocumentDto,
    requestKey?: string,
  ): Promise<InitiationJobDto> {
    if (requestKey !== undefined && !isUUID(requestKey))
      throw new AppException(...AppErrors.ESIGN_INITIATION_INVALID_REQUEST);
    const input = this.normalize(body);
    const hash = canonicalSha256(input);
    const key = requestKey ?? randomUUID();
    const accepted = await this.mysql
      .transaction(async (manager) => {
        const creator = await this.users.findByIdForUpdate(userId, manager);
        if (!creator || !creator.isActive || creator.deletedAt)
          throw new AppException(...AppErrors.ESIGN_INITIATION_NOT_FOUND);
        const document = await this.documents.findInitiationAccess(
          documentId,
          manager,
          true,
        );
        this.access.checkEsignCreator(document, userId);
        const previous = await this.jobs.byKey(documentId, key, manager);
        if (previous) {
          if (previous.requestHash !== hash)
            throw new AppException(
              ...AppErrors.ESIGN_INITIATION_REQUEST_CONFLICT,
            );
          return { job: previous, reused: true };
        }
        this.access.checkEsignDraftCreator(document, userId);
        await this.access.assertNotInitiating(documentId, manager);
        const now = new Date();
        const end = new Date(input.signEndAt);
        if (end <= now)
          throw new AppException(...AppErrors.ESIGN_INITIATION_DEADLINE_PASSED);
        const version = await this.jobs.version(documentId, manager);
        if (!version)
          throw new AppException(...AppErrors.ESIGN_DRAFT_PDF_MISSING);
        const job = await this.jobs.create(
          {
            publicId: randomUUID(),
            documentId,
            createdByUserId: userId,
            requestKey: key,
            requestHash: hash,
            inputJson: input,
            documentVersionJson: version,
            status: 'queued',
            stage: 'queued',
            totalCount: input.signers.length,
            processedCount: 0,
            attemptCount: 0,
            issueCount: 0,
            retryable: false,
            acceptedAt: now,
            deadlineAt: new Date(
              Math.min(now.getTime() + 7200000, end.getTime()),
            ),
            lastProgressAt: now,
          },
          manager,
        );
        return { job, reused: false };
      })
      .catch((error: unknown) => {
        if (error instanceof AppException) throw error;
        throw new AppException(...AppErrors.ESIGN_INITIATION_TRANSIENT_FAILURE);
      });
    if (!accepted.reused)
      await this.producer.enqueueInitiation(accepted.job.id);
    return { ...this.summary(accepted.job), reused: accepted.reused };
  }

  async latest(
    documentId: number,
    userId: number,
  ): Promise<InitiationJobDto | null> {
    const manager = await this.queryManager(documentId, userId);
    const job = await this.jobs.latest(documentId, manager);
    return job ? this.summary(job) : null;
  }

  async get(
    documentId: number,
    publicId: string,
    userId: number,
  ): Promise<InitiationJobDto> {
    const manager = await this.queryManager(documentId, userId);
    const job = await this.jobs.find(documentId, publicId, manager);
    if (!job) throw new AppException(...AppErrors.ESIGN_INITIATION_NOT_FOUND);
    return this.summary(job);
  }

  /** 查詢仍核對目前有效建立人，不沿用部門唯讀權限。 */
  private async queryManager(documentId: number, userId: number) {
    const manager = this.mysql.getManager();
    const creator = await this.users.findById(userId, manager);
    const document = await this.documents.findInitiationAccess(
      documentId,
      manager,
    );
    if (
      !creator ||
      !creator.isActive ||
      creator.deletedAt ||
      !document ||
      document.deletedAt ||
      document.createdByUserId !== userId
    )
      throw new AppException(...AppErrors.ESIGN_INITIATION_NOT_FOUND);
    return manager;
  }

  /** Queue 與測試都使用同一正式服務入口；不依 HTTP session 執行。 */
  async process(jobId: number): Promise<void> {
    const claimed = await this.mysql.transaction((manager) =>
      this.jobs.claim(jobId, manager),
    );
    if (!claimed?.leaseToken || !claimed.inputJson) return;
    const lease: InitiationLease = { jobId, leaseToken: claimed.leaseToken };
    try {
      const { signers, employees } = await this.resolveSigners(
        claimed.inputJson,
        lease,
      );
      lease.expectedEmployees = employees;
      // 此短 CAS 先提交，摘要才能在正式交易進行中看見階段；不代表成功。
      await this.recordProgress(lease, 'committing', signers.length);
      const result = await this.mysql.transaction(async (manager) => {
        const result = await this.initiation.initiateInTransaction(
          {
            ...claimed.inputJson!,
            signers,
            documentId: claimed.documentId,
            creatorUserId: claimed.createdByUserId,
            signStartAt: new Date(claimed.inputJson!.signStartAt),
            signEndAt: new Date(claimed.inputJson!.signEndAt),
          },
          manager,
          lease,
        );
        // 核心已依 users → document → job 鎖定，成功與業務一起提交。
        const current = await this.jobs.byId(jobId, manager, true);
        if (
          !current ||
          current.status !== 'processing' ||
          current.leaseToken !== lease.leaseToken ||
          current.deadlineAt <= new Date()
        )
          throw new AppException(
            ...AppErrors.ESIGN_INITIATION_PROCESSING_TIMEOUT,
          );
        current.status = 'succeeded';
        current.stage = 'completed';
        current.processedCount = current.totalCount;
        current.completedAt = new Date();
        current.lastProgressAt = current.completedAt;
        current.leaseToken = null;
        current.leaseExpiresAt = null;
        current.errorCode = null;
        await this.jobs.save(current, manager);
        return result;
      });
      await this.producer.enqueueInvitations(...result.notificationJobs);
    } catch (error) {
      const code = error instanceof AppException ? error.code : null;
      const failure = code?.startsWith('ESIGN_INITIATION_')
        ? code
        : code?.includes('EMPLOYEE')
          ? 'ESIGN_INITIATION_EMPLOYEE_UNAVAILABLE'
          : error instanceof AppException
            ? 'ESIGN_INITIATION_INPUT_INVALID'
            : 'ESIGN_INITIATION_INTERNAL_ERROR';
      await this.jobs.fail(lease, failure, this.mysql.getManager());
    }
  }

  private async resolveSigners(
    input: InitiateDocumentDto,
    lease: InitiationLease,
  ): Promise<{ signers: SignerInputDto[]; employees: Map<number, string> }> {
    const signers: SignerInputDto[] = [];
    const employees = new Map<number, string>();
    const manager = this.mysql.getManager();
    for (let offset = 0; offset < input.signers.length; offset += 500) {
      // 每批開始與完成皆確認擁有權／期限，不能失租後繼續消化整份名單。
      await this.recordProgress(lease, 'resolving', offset);
      const batch = input.signers.slice(offset, offset + 500);
      const userIds = batch
        .filter((s) => s.type === 'user')
        .map((s) => Number(s.userId));
      const employeeNos = batch
        .filter((s) => s.type === 'employee')
        .map((s) => s.employeeNo!);
      const byId = new Map(
        (await this.users.findByIds(userIds, manager)).map((user) => [
          Number(user.id),
          user,
        ]),
      );
      const byEmployee = new Map(
        (await this.users.findByEmpids(employeeNos, manager)).map((user) => [
          user.empid,
          user,
        ]),
      );
      for (const signer of batch) {
        if (signer.type === 'email') {
          signers.push({
            type: 'email',
            name: signer.name,
            email: signer.email,
          });
          continue;
        }
        const user =
          signer.type === 'employee'
            ? byEmployee.get(signer.employeeNo!)
            : byId.get(Number(signer.userId));
        if (
          !user ||
          !user.isActive ||
          user.deletedAt ||
          !/^[A-Za-z0-9]{1,20}$/.test(user.empid)
        )
          throw new AppException(
            ...AppErrors.ESIGN_INITIATION_EMPLOYEE_UNAVAILABLE,
          );
        employees.set(Number(user.id), user.empid);
        signers.push({ type: 'user', userId: String(user.id) });
      }
      await this.recordProgress(lease, 'resolving', signers.length);
    }
    await this.recordProgress(lease, 'validating', signers.length);
    return { signers, employees };
  }

  private async recordProgress(
    lease: InitiationLease,
    stage: 'resolving' | 'validating' | 'committing',
    processedCount: number,
  ): Promise<void> {
    if (
      !(await this.jobs.progress(
        lease,
        stage,
        processedCount,
        this.mysql.getManager(),
      ))
    )
      throw new AppException(...AppErrors.ESIGN_INITIATION_PROCESSING_TIMEOUT);
  }

  private normalize(body: InitiateDocumentDto): InitiateDocumentDto {
    const start = new Date(body.signStartAt);
    const end = new Date(body.signEndAt);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start >= end ||
      !body.signers.length
    )
      throw new AppException(...AppErrors.ESIGN_INITIATION_INVALID_REQUEST);
    const internal = new Set(
      body.signers.filter((s) => s.type !== 'email').map((s) => s.type),
    );
    if (internal.size > 1)
      throw new AppException(...AppErrors.ESIGN_INITIATION_INVALID_REQUEST);
    const signers = body.signers.map((signer) =>
      signer.type === 'email'
        ? {
            ...signer,
            name: signer.name!.trim(),
            email: signer.email!.trim().toLowerCase(),
          }
        : { ...signer },
    );
    const identities = signers.map(
      (s) =>
        `${s.type}:${s.type === 'employee' ? s.employeeNo : s.type === 'user' ? s.userId : s.email}`,
    );
    if (
      new Set(identities).size !== identities.length ||
      body.fields.some(
        (f) =>
          f.xPercent + f.widthPercent > 100 ||
          f.yPercent + f.heightPercent > 100,
      )
    )
      throw new AppException(...AppErrors.ESIGN_INITIATION_INVALID_REQUEST);
    return {
      ...body,
      signers,
      signStartAt: start.toISOString(),
      signEndAt: end.toISOString(),
    };
  }

  summary(job: EsignInitiationJob): InitiationJobDto {
    return {
      jobId: job.publicId,
      documentId: String(job.documentId),
      status: job.status,
      stage: job.stage,
      totalCount: job.totalCount,
      processedCount: job.processedCount,
      attemptCount: job.attemptCount,
      acceptedAt: job.acceptedAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      deadlineAt: job.deadlineAt.toISOString(),
      nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      errorCode: job.errorCode ?? null,
      retryable: job.retryable,
      issueCount: job.issueCount,
      detailsExpired: !!job.inputPurgedAt,
    };
  }
}
