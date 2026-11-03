import type { OrgDepartmentDto } from '#app/infrastructure/http-client/feastogether/types/org-chart.dto';
import { Injectable } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { FeastogetherDepartmentService } from '#app/infrastructure/http-client/feastogether/services/feastogether-department.service';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { MailRecipientWhitelistRepository } from './mail-recipient-whitelist.repository';
import type { MailRecipientWhitelistType } from './mail-recipient-whitelist.entity';
import { MailWhitelistCheckFailedError } from './mail-recipient-policy.errors';

interface RecipientWhitelistRules {
  employeeIds: ReadonlySet<string>;
  departmentIds: ReadonlySet<string>;
  emails: ReadonlySet<string>;
}

@Injectable()
export class MailRecipientPolicyService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly rules: MailRecipientWhitelistRepository,
    private readonly departments: FeastogetherDepartmentService,
    private readonly hr: FeastogetherHrService,
  ) {}

  /**
   * 每次寄送重新讀取，查詢結果只在本次呼叫共用。
   * 收件人全數命中信箱規則時不查人資來源。
   */
  async allowedRecipients(emails: readonly string[]): Promise<Set<string>> {
    try {
      const rules = await this.loadActiveRules();
      const allowed = new Set(
        emails.filter((email) => rules.emails.has(email)),
      );
      const remaining = emails.filter((email) => !allowed.has(email));
      if (!remaining.length) return allowed;

      const employeeIds = await this.collectCandidateEmployeeIds(rules);
      if (!employeeIds.size) return allowed;

      const matched = await this.matchRecipientEmails(employeeIds, remaining);
      return new Set([...allowed, ...matched]);
    } catch {
      throw new MailWhitelistCheckFailedError();
    }
  }

  /** 將最新有效規則分為完整員編、精確部門代碼與完整收件信箱。 */
  private async loadActiveRules(): Promise<RecipientWhitelistRules> {
    const rules = await this.rules.findActiveRules(this.mysql.getManager());
    const valuesOf = (type: MailRecipientWhitelistType) =>
      new Set(
        rules.filter((rule) => rule.type === type).map((rule) => rule.value),
      );
    return {
      employeeIds: valuesOf('employee'),
      departmentIds: valuesOf('department'),
      emails: valuesOf('email'),
    };
  }

  /** 合併額外允許員編與白名單部門的直接員工。 */
  private async collectCandidateEmployeeIds(
    rules: RecipientWhitelistRules,
  ): Promise<Set<string>> {
    const employeeIds = new Set(rules.employeeIds);
    if (rules.departmentIds.size) {
      const departments = await this.departments.getOrgChart();
      this.collectDepartmentEmployeeIds(
        departments,
        rules.departmentIds,
        employeeIds,
      );
    }
    return employeeIds;
  }

  /** 走訪所有節點尋找精確部門，不因上層命中而放行子部門。 */
  private collectDepartmentEmployeeIds(
    departments: readonly OrgDepartmentDto[],
    allowedDepartmentIds: ReadonlySet<string>,
    employeeIds: Set<string>,
  ): void {
    for (const department of departments) {
      if (allowedDepartmentIds.has(department.department_ch_id)) {
        for (const employee of department.employees) {
          employeeIds.add(employee.person_empid);
        }
      }
      this.collectDepartmentEmployeeIds(
        department.children,
        allowedDepartmentIds,
        employeeIds,
      );
    }
  }

  /** 分批取得可信信箱，只保留本次收件人，重複信箱由 Set 去重。 */
  private async matchRecipientEmails(
    employeeIds: ReadonlySet<string>,
    emails: readonly string[],
  ): Promise<Set<string>> {
    const ids = [...employeeIds];
    const requestedEmails = new Set(emails);
    const addresses = new Set<string>();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const mapped = await this.hr.getStaffEmails(
        ids.slice(offset, offset + 100),
      );
      for (const email of mapped.values()) {
        if (email && requestedEmails.has(email)) addresses.add(email);
      }
    }
    return addresses;
  }
}
