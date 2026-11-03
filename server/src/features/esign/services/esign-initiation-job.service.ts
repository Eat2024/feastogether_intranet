import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { randomUUID } from 'node:crypto';
import { isUUID, isEmail } from 'class-validator';
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
import {
  type InitiationJobDto,
  type InitiationIssuesDto,
  type InitiationIssuesQueryDto,
} from '../dto/initiation-job.dto';
import {
  type EsignInitiationJob,
  type InitiationIssue,
} from '../entities/esign-initiation-job.entity';
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
    private readonly logger: AppLoggerService,
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
    await this.preflightAcceptance(documentId, userId, requestKey);
    const accepted = await this.mysql
      .transaction(async (manager) => {
        const creator = await this.users.findByIdForShare(userId, manager);
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
      }, 'READ COMMITTED')
      .catch((error: unknown) => {
        if (error instanceof AppException) throw error;
        throw new AppException(...AppErrors.ESIGN_INITIATION_TRANSIENT_FAILURE);
      });
    if (!accepted.reused) {
      this.logJob(accepted.job, 'esign.initiation_accepted');
      await this.producer.enqueueInitiation(accepted.job.id);
    }
    return { ...this.summary(accepted.job), reused: accepted.reused };
  }

  /** 人工重試的 key 屬於 parent + 原 hash；重播不依賴仍保留敏感明細。 */
  async retry(
    documentId: number,
    publicId: string,
    userId: number,
    requestKey: string | undefined,
    body: unknown,
  ): Promise<InitiationJobDto> {
    if (
      !requestKey ||
      !isUUID(requestKey) ||
      (body !== undefined &&
        (body === null ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length))
    )
      throw new AppException(...AppErrors.ESIGN_INITIATION_INVALID_REQUEST);
    await this.preflightAcceptance(documentId, userId, requestKey, publicId);
    const accepted = await this.mysql
      .transaction(async (manager) => {
        const creator = await this.users.findByIdForShare(userId, manager);
        if (!creator || !creator.isActive || creator.deletedAt)
          throw new AppException(...AppErrors.ESIGN_INITIATION_NOT_FOUND);
        const document = await this.documents.findInitiationAccess(
          documentId,
          manager,
          true,
        );
        if (
          !document ||
          document.deletedAt ||
          document.createdByUserId !== userId
        )
          throw new AppException(...AppErrors.ESIGN_INITIATION_NOT_FOUND);
        const previous = await this.jobs.byKey(documentId, requestKey, manager);
        const parent = await this.jobs.find(
          documentId,
          publicId,
          manager,
          undefined,
          true,
        );
        if (!parent)
          throw new AppException(...AppErrors.ESIGN_INITIATION_NOT_FOUND);
        const hash = canonicalSha256({
          operation: 'retry',
          parentJobId: String(parent.id),
          requestHash: parent.requestHash,
        });
        if (previous) {
          if (
            String(previous.parentJobId) !== String(parent.id) ||
            previous.requestHash !== hash
          )
            throw new AppException(
              ...AppErrors.ESIGN_INITIATION_REQUEST_CONFLICT,
            );
          return { job: previous, reused: true };
        }
        await this.access.assertNotInitiating(documentId, manager);
        const latest = await this.jobs.latest(documentId, manager, true);
        if (
          latest?.id !== parent.id ||
          parent.status !== 'failed' ||
          !parent.retryable ||
          document.status !== 'draft'
        )
          throw new AppException(
            ...AppErrors.ESIGN_INITIATION_RETRY_NOT_ALLOWED,
          );
        const detail = await this.jobs.byId(parent.id, manager, true, true);
        if (
          parent.inputPurgedAt ||
          !detail?.inputJson ||
          !detail.documentVersionJson
        )
          throw new AppException(...AppErrors.ESIGN_INITIATION_INPUT_EXPIRED);
        const version = await this.jobs.version(documentId, manager);
        if (
          !version ||
          canonicalSha256(version) !==
            canonicalSha256(detail.documentVersionJson)
        )
          throw new AppException(
            ...AppErrors.ESIGN_INITIATION_DOCUMENT_CHANGED,
          );
        const now = new Date();
        const end = new Date(detail.inputJson.signEndAt);
        if (end <= now)
          throw new AppException(...AppErrors.ESIGN_INITIATION_DEADLINE_PASSED);
        const job = await this.jobs.create(
          {
            publicId: randomUUID(),
            documentId,
            createdByUserId: userId,
            requestKey,
            requestHash: hash,
            parentJobId: parent.id,
            inputJson: detail.inputJson,
            documentVersionJson: detail.documentVersionJson,
            status: 'queued',
            stage: 'queued',
            totalCount: detail.inputJson.signers.length,
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
      }, 'READ COMMITTED')
      .catch((error: unknown) => {
        if (error instanceof AppException) throw error;
        throw new AppException(...AppErrors.ESIGN_INITIATION_TRANSIENT_FAILURE);
      });
    if (!accepted.reused) {
      this.logJob(accepted.job, 'esign.initiation_accepted');
      await this.producer.enqueueInitiation(accepted.job.id);
    }
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

  async input(
    documentId: number,
    publicId: string,
    userId: number,
  ): Promise<InitiateDocumentDto> {
    const manager = await this.queryManager(documentId, userId);
    const job = await this.jobs.find(
      documentId,
      publicId,
      manager,
      'inputJson',
    );
    if (!job) throw new AppException(...AppErrors.ESIGN_INITIATION_NOT_FOUND);
    if (job.inputPurgedAt || !job.inputJson)
      throw new AppException(...AppErrors.ESIGN_INITIATION_INPUT_EXPIRED);
    const { signers, fields, signStartAt, signEndAt, watermark, allowReject } =
      job.inputJson;
    return { signers, fields, signStartAt, signEndAt, watermark, allowReject };
  }

  async issues(
    documentId: number,
    publicId: string,
    userId: number,
    query: InitiationIssuesQueryDto,
  ): Promise<InitiationIssuesDto> {
    const manager = await this.queryManager(documentId, userId);
    const job = await this.jobs.find(
      documentId,
      publicId,
      manager,
      'issuesJson',
    );
    if (!job) throw new AppException(...AppErrors.ESIGN_INITIATION_NOT_FOUND);
    if (job.status !== 'failed')
      throw new AppException(...AppErrors.ESIGN_INITIATION_ISSUES_NOT_READY);
    if (job.inputPurgedAt)
      throw new AppException(...AppErrors.ESIGN_INITIATION_INPUT_EXPIRED);
    const items = (job.issuesJson ?? [])
      .slice(query.offset, query.offset + query.limit)
      .map((issue) => ({
        inputIndex: issue.inputIndex,
        ...(issue.employeeNo ? { employeeNo: issue.employeeNo } : {}),
        code: issue.code,
        message:
          issue.code === 'EMPLOYEE_UNAVAILABLE'
            ? AppErrors.ESIGN_INITIATION_EMPLOYEE_UNAVAILABLE[1]
            : AppErrors.ESIGN_INITIATION_INPUT_INVALID[1],
      }));
    const next = query.offset + items.length;
    return {
      total: job.issueCount,
      items,
      nextOffset: next < job.issueCount ? next : null,
    };
  }

  /** 只快拒新請求；歷史 key 也必須保留鎖內 hash/parent 驗證及重播優先。 */
  private async preflightAcceptance(
    documentId: number,
    userId: number,
    requestKey?: string,
    parentPublicId?: string,
  ): Promise<void> {
    try {
      const manager = await this.queryManager(documentId, userId);
      if (
        parentPublicId &&
        !(await this.jobs.hasPublicId(documentId, parentPublicId, manager))
      )
        throw new AppException(...AppErrors.ESIGN_INITIATION_NOT_FOUND);
      if (
        requestKey &&
        (await this.jobs.hasKey(documentId, requestKey, manager))
      )
        return;
      if (await this.jobs.hasActive(documentId, manager))
        throw new AppException(...AppErrors.ESIGN_INITIATION_IN_PROGRESS);
    } catch (error: unknown) {
      if (error instanceof AppException) throw error;
      throw new AppException(...AppErrors.ESIGN_INITIATION_TRANSIENT_FAILURE);
    }
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
    const claimed = await this.mysql
      .transaction((manager) => this.jobs.claim(jobId, manager))
      .catch(() => {
        this.logger.warn({
          event: 'esign.initiation_claim_unavailable',
          context: EsignInitiationJobService.name,
          metadata: { jobId },
        });
        throw new Error('背景發起工作暫時無法取得');
      });
    if (!claimed?.leaseToken || !claimed.inputJson) return;
    const lease: InitiationLease = { jobId, leaseToken: claimed.leaseToken };
    const heartbeat = this.startHeartbeat(lease);
    const issues: InitiationIssue[] = [];
    let notificationJobs:
      | Parameters<EsignJobProducerService['enqueueInvitations']>
      | undefined;
    this.logJob(claimed, 'esign.initiation_started');
    try {
      const { signers, employees } = await this.resolveSigners(
        claimed.inputJson,
        lease,
        issues,
      );
      lease.expectedEmployees = employees;
      // 此短 CAS 先提交，摘要才能在正式交易進行中看見階段；不代表成功。
      await this.recordProgress(lease, 'committing', signers.length);
      // 先清空在途續租，再進正式交易；絕不持有 job 鎖等待同列 heartbeat。
      await heartbeat.stop();
      heartbeat.assertHealthy();
      if (!(await this.jobs.renew(lease, this.mysql.getManager())))
        throw new AppException(
          ...AppErrors.ESIGN_INITIATION_PROCESSING_TIMEOUT,
        );
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
        if (current.deadlineAt <= new Date())
          throw new AppException(
            ...AppErrors.ESIGN_INITIATION_PROCESSING_TIMEOUT,
          );
        return result;
      });
      notificationJobs = result.notificationJobs;
      this.logJob(
        {
          ...claimed,
          status: 'succeeded',
          stage: 'completed',
          errorCode: null,
        },
        'esign.initiation_succeeded',
      );
    } catch (error) {
      await heartbeat.stop();
      const failure = this.classifyFailure(error, claimed.createdByUserId);
      if (!issues.length)
        issues.push(...this.validationIssues(error, claimed.inputJson, lease));
      try {
        const settled = await this.mysql.transaction((manager) =>
          this.jobs.fail(
            lease,
            failure.code,
            failure.transient,
            manager,
            issues,
          ),
        );
        if (settled)
          this.logJob(
            settled,
            settled.status === 'queued'
              ? 'esign.initiation_retry_waiting'
              : 'esign.initiation_failed',
          );
      } catch {
        this.logger.warn({
          event: 'esign.initiation_recovery_pending',
          context: EsignInitiationJobService.name,
          metadata: {
            jobId: claimed.publicId,
            documentId: String(claimed.documentId),
            attempt: claimed.attemptCount,
            errorCode: failure.code,
          },
        });
        throw new Error('背景發起工作狀態暫時無法保存');
      }
    } finally {
      await heartbeat.stop();
    }
    // 業務已提交；通知入列故障只能交給既有通知 outbox，不再進失敗處理。
    if (notificationJobs) {
      try {
        await this.producer.enqueueInvitations(...notificationJobs);
      } catch {
        this.logger.warn({
          event: 'esign.initiation_notifications_pending',
          context: EsignInitiationJobService.name,
          metadata: {
            jobId: claimed.publicId,
            documentId: String(claimed.documentId),
          },
        });
      }
    }
  }

  /** 獨立於批次完成的續租；只允許一個在途更新，所有錯誤交還主流程。 */
  private startHeartbeat(lease: InitiationLease) {
    let ongoing: Promise<void> | null = null;
    let failure: Error | undefined;
    let stopped = false;
    let lastRenewedAt = Date.now();
    const timer = setInterval(() => {
      if (stopped || ongoing || failure) return;
      ongoing = (async () => {
        try {
          const renew = Date.now() - lastRenewedAt >= 30000;
          const owned = await this.jobs.heartbeat(
            lease,
            renew,
            this.mysql.getManager(),
          );
          if (!owned)
            throw new AppException(
              ...AppErrors.ESIGN_INITIATION_PROCESSING_TIMEOUT,
            );
          if (renew) lastRenewedAt = Date.now();
        } catch (error) {
          failure =
            error instanceof Error
              ? error
              : new Error('背景查核連線暫時無法更新');
        } finally {
          ongoing = null;
        }
      })();
    }, 5000);
    timer.unref();
    return {
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        await ongoing;
      },
      assertHealthy: () => {
        if (failure) throw failure;
      },
    };
  }

  /** 沿既有維護喚醒收斂 lease／deadline，再於交易外可靠補列。 */
  async maintain(now = new Date()): Promise<void> {
    let afterId = 0;
    while (true) {
      const rows = await this.mysql.transaction((manager) =>
        this.jobs.recover(now, afterId, manager),
      );
      if (!rows.length) break;
      for (const row of rows) {
        if (
          row.status === 'queued' &&
          (!row.nextAttemptAt || row.nextAttemptAt <= now)
        )
          await this.producer.enqueueInitiation(row.id);
        else this.logJob(row, 'esign.initiation_reconciled');
      }
      afterId = rows[rows.length - 1].id;
    }
    // 沿既有 maintenance 喚醒分批清理；不以一般保留期限清除非終態工作。
    afterId = 0;
    while (true) {
      const ids = await this.mysql.transaction((manager) =>
        this.jobs.purgeInputs(now, afterId, manager),
      );
      if (!ids.length) return;
      afterId = ids[ids.length - 1];
    }
  }

  private logJob(job: EsignInitiationJob, event: string): void {
    this.logger.info({
      event,
      context: EsignInitiationJobService.name,
      metadata: {
        jobId: job.publicId,
        documentId: String(job.documentId),
        status: job.status,
        stage: job.stage,
        attempt: job.attemptCount,
        errorCode: job.errorCode ?? null,
      },
    });
  }

  /** 鎖內身分查核的 ID 只用來對回此次輸入，不回傳帳號資料或原始錯誤。 */
  private validationIssues(
    error: unknown,
    input: InitiateDocumentDto,
    lease: InitiationLease,
  ): InitiationIssue[] {
    if (!(error instanceof AppException)) return [];
    const response = error.getResponse();
    if (typeof response !== 'object' || !('details' in response)) return [];
    const details: unknown = response.details;
    if (
      !details ||
      typeof details !== 'object' ||
      !('userIds' in details) ||
      !Array.isArray(details.userIds)
    )
      return [];
    const ids = new Set(
      details.userIds.filter((id): id is string => typeof id === 'string'),
    );
    const employeeNos = new Set(
      [...(lease.expectedEmployees ?? [])]
        .filter(([id]) => ids.has(String(id)))
        .map(([, employeeNo]) => employeeNo),
    );
    return input.signers.flatMap((signer, inputIndex) => {
      const invalid =
        signer.type === 'user'
          ? ids.has(signer.userId!)
          : signer.type === 'employee' && employeeNos.has(signer.employeeNo!);
      if (!invalid) return [];
      const employeeNo =
        signer.type === 'employee'
          ? signer.employeeNo
          : lease.expectedEmployees?.get(Number(signer.userId));
      return [
        {
          inputIndex,
          ...(employeeNo ? { employeeNo } : {}),
          code: 'EMPLOYEE_UNAVAILABLE',
        },
      ];
    });
  }

  private classifyFailure(
    error: unknown,
    creatorUserId: number,
  ): { code: string; transient: boolean } {
    if (error instanceof AppException) {
      if (
        error.code === 'ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE' ||
        error.code === 'ESIGN_INITIATION_TRANSIENT_FAILURE'
      )
        return { code: 'ESIGN_INITIATION_TRANSIENT_FAILURE', transient: true };
      if (error.code.startsWith('ESIGN_INITIATION_'))
        return { code: error.code, transient: false };
      const response = error.getResponse();
      if (typeof response === 'object' && 'details' in response) {
        const details: unknown = response.details;
        if (
          details &&
          typeof details === 'object' &&
          'userIds' in details &&
          Array.isArray(details.userIds) &&
          details.userIds.includes(String(creatorUserId))
        )
          return {
            code: 'ESIGN_INITIATION_CREATOR_UNAVAILABLE',
            transient: false,
          };
      }
      return {
        code: error.code.includes('EMPLOYEE')
          ? 'ESIGN_INITIATION_EMPLOYEE_UNAVAILABLE'
          : 'ESIGN_INITIATION_INPUT_INVALID',
        transient: false,
      };
    }
    const cause =
      error && typeof error === 'object' && 'driverError' in error
        ? error.driverError
        : error;
    const code =
      cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
    if (
      typeof code === 'string' &&
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EPIPE',
        'PROTOCOL_CONNECTION_LOST',
        'ER_LOCK_DEADLOCK',
        'ER_LOCK_WAIT_TIMEOUT',
        'ER_CON_COUNT_ERROR',
        'ER_SERVER_SHUTDOWN',
      ].includes(code)
    )
      return { code: 'ESIGN_INITIATION_TRANSIENT_FAILURE', transient: true };
    return { code: 'ESIGN_INITIATION_INTERNAL_ERROR', transient: false };
  }

  private async resolveSigners(
    input: InitiateDocumentDto,
    lease: InitiationLease,
    issues: InitiationIssue[],
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
      for (const [index, signer] of batch.entries()) {
        if (signer.type === 'email') {
          if (
            !signer.name?.trim() ||
            signer.name.trim().length > 100 ||
            !signer.email ||
            signer.email.length > 255 ||
            !isEmail(signer.email)
          ) {
            issues.push({ inputIndex: offset + index, code: 'INPUT_INVALID' });
            continue;
          }
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
        ) {
          issues.push({
            inputIndex: offset + index,
            ...(signer.type === 'employee'
              ? { employeeNo: signer.employeeNo }
              : user?.empid
                ? { employeeNo: user.empid }
                : {}),
            code: 'EMPLOYEE_UNAVAILABLE',
          });
          continue;
        }
        employees.set(Number(user.id), user.empid);
        signers.push({ type: 'user', userId: String(user.id) });
      }
      await this.recordProgress(lease, 'resolving', offset + batch.length);
    }
    if (issues.some((issue) => issue.code === 'EMPLOYEE_UNAVAILABLE'))
      throw new AppException(
        ...AppErrors.ESIGN_INITIATION_EMPLOYEE_UNAVAILABLE,
      );
    if (issues.length)
      throw new AppException(...AppErrors.ESIGN_INITIATION_INPUT_INVALID);
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
