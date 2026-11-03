import { Injectable } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { UserRepository } from '#app/features/users/repositories/user.repository';
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
    private readonly users: UserRepository,
  ) {}

  /**
   * 每次寄送重新讀取，查詢結果只在本次呼叫共用。
   * 收件地址須已由寄送邊界正規化（trim、小寫）。
   * 收件人全數命中信箱規則時不查員工主檔。
   */
  async allowedRecipients(recipients: readonly string[]): Promise<Set<string>> {
    try {
      const rules = await this.loadActiveRules();
      const allowed = new Set(
        recipients.filter((recipient) => rules.emails.has(recipient)),
      );
      const remaining = recipients.filter(
        (recipient) => !allowed.has(recipient),
      );
      if (!remaining.length) return allowed;

      if (!rules.employeeIds.size && !rules.departmentIds.size) return allowed;
      const emails = await this.users.findMailWhitelistEmails(
        [...rules.employeeIds],
        [...rules.departmentIds],
        this.mysql.getManager(),
      );
      const matched = new Set(emails);
      for (const recipient of remaining) {
        if (matched.has(recipient)) allowed.add(recipient);
      }
      return allowed;
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
}
