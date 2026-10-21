import { Injectable } from '@nestjs/common';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { DocumentRepository } from '../repositories/document.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EmployeeEmailCheckResultDto } from '../dto/employee-directory-response.dto';

export interface EmployeeEmailIdentity {
  userId: number;
  empid: string;
}
export interface EmployeeEmailResult extends EmployeeEmailIdentity {
  email: string | null;
}

/** 預覽及發起共用的員工核對，不保存信箱，也不寄送通知。 */
@Injectable()
export class EsignEmployeeEmailService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly users: UserRepository,
    private readonly documents: DocumentRepository,
    private readonly access: EsignAccessPolicyService,
    private readonly validation: EsignDocumentValidationService,
    private readonly hr: FeastogetherHrService,
  ) {}

  async checkDraft(
    documentId: number,
    creatorUserId: number,
    userIds: string[],
  ): Promise<EmployeeEmailCheckResultDto> {
    const document = await this.documents.findById(
      documentId,
      this.mysql.getManager(),
    );
    this.access.checkEsignCreator(document, creatorUserId);
    this.validation.checkStillDraft(document);
    const identities = await this.resolveUsers(userIds);
    const results = await this.lookupEmails(identities);
    return {
      items: results.map(({ userId, email }) => ({
        userId: String(userId),
        status: email ? ('ready' as const) : ('unavailable' as const),
        maskedEmail: email
          ? `${email[0]}***${email.slice(email.lastIndexOf('@'))}`
          : null,
      })),
    };
  }

  /** 呼叫端可於發起交易內再次讀取，以比對查詢前後身分是否一致。 */
  async resolveUsers(
    userIds: string[],
    manager = this.mysql.getManager(),
  ): Promise<EmployeeEmailIdentity[]> {
    if (
      !Array.isArray(userIds) ||
      userIds.length < 1 ||
      userIds.length > 6000 ||
      userIds.some(
        (id) =>
          typeof id !== 'string' ||
          !/^[1-9][0-9]*$/.test(id) ||
          !Number.isSafeInteger(Number(id)),
      )
    ) {
      throw new AppException(...AppErrors.ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE);
    }
    const ids = [...new Set(userIds)];
    const userById = new Map<
      number,
      { empid: string; isActive: boolean; deletedAt?: Date | null }
    >();
    for (let offset = 0; offset < ids.length; offset += 500) {
      for (const user of await this.users.findByIds(
        ids.slice(offset, offset + 500).map(Number),
        manager,
      )) {
        userById.set(Number(user.id), user);
      }
    }
    const unavailable = ids.filter((id) => {
      const user = userById.get(Number(id));
      return (
        !user ||
        !user.isActive ||
        !!user.deletedAt ||
        !/^[A-Za-z0-9]{1,20}$/.test(user.empid)
      );
    });
    if (unavailable.length)
      throw new AppException(...AppErrors.ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE, {
        userIds: unavailable,
      });
    return ids.map((id) => ({
      userId: Number(id),
      empid: userById.get(Number(id))!.empid,
    }));
  }

  /** 不持有文件交易；完整核對完才回傳，不提供部分結果。 */
  async lookupEmails(
    identities: readonly EmployeeEmailIdentity[],
  ): Promise<EmployeeEmailResult[]> {
    const emails = new Map<string, string | null>();
    const empids = [...new Set(identities.map((identity) => identity.empid))];
    let offset = 0;
    let failed = false;
    const run = async () => {
      while (!failed && offset < empids.length) {
        const batch = empids.slice(offset, offset + 100);
        offset += 100;
        try {
          for (const [empid, email] of await this.hr.getStaffEmails(batch))
            emails.set(empid, email);
        } catch {
          failed = true;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, Math.ceil(empids.length / 100)) }, run),
    );
    if (failed)
      throw new AppException(
        ...AppErrors.ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE,
      );
    return identities.map((identity) => ({
      ...identity,
      email: emails.get(identity.empid) ?? null,
    }));
  }
}
