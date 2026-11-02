import type { OrgDepartmentDto } from '#app/infrastructure/http-client/feastogether/types/org-chart.dto';
import { Injectable } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { FeastogetherDepartmentService } from '#app/infrastructure/http-client/feastogether/services/feastogether-department.service';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { MailRecipientWhitelistRepository } from './mail-recipient-whitelist.repository';
import { MailWhitelistCheckFailedError } from './mail-recipient-policy.errors';

@Injectable()
export class MailRecipientPolicyService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly rules: MailRecipientWhitelistRepository,
    private readonly departments: FeastogetherDepartmentService,
    private readonly hr: FeastogetherHrService,
  ) {}

  /** 每次寄送重新讀取，查詢結果只在本次呼叫共用。 */
  async allowedRecipients(emails: readonly string[]): Promise<Set<string>> {
    try {
      const rules = await this.rules.findActive(this.mysql.getManager());
      const employeeRules = new Set(
        rules
          .filter((rule) => rule.type === 'employee')
          .map((rule) => rule.value),
      );
      const departmentRules = new Set(
        rules
          .filter((rule) => rule.type === 'department')
          .map((rule) => rule.value),
      );
      const employees = new Set(employeeRules);
      if (departmentRules.size) {
        const visit = (nodes: OrgDepartmentDto[]) => {
          for (const node of nodes) {
            if (departmentRules.has(node.department_ch_id))
              for (const employee of node.employees)
                employees.add(employee.person_empid);
            visit(node.children);
          }
        };
        visit(await this.departments.getOrgChart());
      }
      if (!employees.size) return new Set();
      const ids = [...employees];
      const requestedEmails = new Set(emails);
      const matched = new Map<string, string>();
      const addresses = new Set<string>();
      for (let offset = 0; offset < ids.length; offset += 100) {
        const mapped = await this.hr.getStaffEmails(
          ids.slice(offset, offset + 100),
        );
        for (const [id, email] of mapped) {
          if (!email || !requestedEmails.has(email)) continue;
          if (addresses.has(email)) throw new MailWhitelistCheckFailedError();
          addresses.add(email);
          matched.set(id, email);
        }
      }
      const allowed = new Set<string>();
      const candidates = [...matched];
      for (let offset = 0; offset < candidates.length; offset += 4) {
        await Promise.all(
          candidates.slice(offset, offset + 4).map(async ([id, email]) => {
            const result = await this.hr.lookupMailEligibleStaff(id);
            if (
              result.status === 'eligible' &&
              result.staff.person_empid === id &&
              (employeeRules.has(id) ||
                (result.staff.department_id &&
                  departmentRules.has(result.staff.department_id)))
            )
              allowed.add(email);
          }),
        );
      }
      return allowed;
    } catch {
      throw new MailWhitelistCheckFailedError();
    }
  }
}
