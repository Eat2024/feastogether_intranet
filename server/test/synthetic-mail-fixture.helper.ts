import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { FeastogetherClient } from '#app/infrastructure/http-client/feastogether/feastogether.client';
import { FeastogetherDepartmentService } from '#app/infrastructure/http-client/feastogether/services/feastogether-department.service';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { GuardedInvitationMailSender } from '#app/infrastructure/mail/guarded-invitation-mail-sender.service';
import {
  INVITATION_MAIL_SENDER,
  type InvitationMailSender,
} from '#app/infrastructure/mail/invitation-mail-sender.port';
import { MailRecipientPolicyService } from '#app/infrastructure/mail/mail-recipient-policy.service';
import { MailRecipientWhitelist } from '#app/infrastructure/mail/mail-recipient-whitelist.entity';
import { MailRecipientWhitelistRepository } from '#app/infrastructure/mail/mail-recipient-whitelist.repository';
import { WorkerModule } from '#app/worker.module';

/** 舊流程 E2E 的有限合成人資名單；只有案例安排階段登錄的地址可被寄送。 */
export class SyntheticMailFixture {
  readonly adapter = new FakeInvitationMailSender();
  private readonly department = `TESTMAIL${randomBytes(5).toString('hex')}`;
  private readonly staff = new Map<string, string>();
  private config?: ConfigService;
  private policy?: MailRecipientPolicyService;
  private guarded?: GuardedInvitationMailSender;

  constructor(emails: readonly string[] = []) {
    this.allowEmails(emails);
  }

  allowEmails(emails: readonly string[]): void {
    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      if (![...this.staff.values()].includes(email))
        this.staff.set(`M${this.department.slice(8)}${this.staff.size}`, email);
    }
  }

  get sender(): GuardedInvitationMailSender {
    if (!this.guarded) throw new Error('合成寄信 fixture 尚未初始化');
    return this.guarded;
  }

  guard(adapter: InvitationMailSender): GuardedInvitationMailSender {
    if (!this.config || !this.policy)
      throw new Error('合成寄信 fixture 尚未初始化');
    return new GuardedInvitationMailSender(this.config, this.policy, adapter);
  }

  install(builder: TestingModuleBuilder): TestingModuleBuilder {
    return builder.overrideProvider(INVITATION_MAIL_SENDER).useFactory({
      inject: [
        ConfigService,
        MysqlService,
        MailRecipientWhitelistRepository,
        FeastogetherClient,
      ],
      factory: (
        config: ConfigService,
        mysql: MysqlService,
        rules: MailRecipientWhitelistRepository,
        client: FeastogetherClient,
      ) => {
        // 只替換上游服務邊界；實際 DB 規則讀取、政策與 guard 都保留。
        const departments = new FeastogetherDepartmentService(client);
        const hr = new FeastogetherHrService(client);
        departments.getOrgChart = () =>
          Promise.resolve([
            {
              department_ch_id: this.department,
              department_name: '合成寄信部門',
              department_parent_guid: null,
              startdate: null,
              stopdate: null,
              children: [],
              employees: [...this.staff.keys()].map((person_empid) => ({
                person_empid,
                person_name: '合成收件員工',
                title: null,
              })),
            },
          ]);
        hr.getStaffEmails = (ids) =>
          Promise.resolve(
            new Map(ids.map((id) => [id, this.staff.get(id) ?? null])),
          );
        hr.lookupMailEligibleStaff = (id) =>
          Promise.resolve(
            this.staff.has(id)
              ? {
                  status: 'eligible',
                  staff: {
                    person_empid: id,
                    person_name: '合成收件員工',
                    person_status: 1,
                    person_status_name: '正式',
                    department_id: this.department,
                    department_name: '合成寄信部門',
                    title: null,
                  },
                }
              : { status: 'ineligible' },
          );
        this.config = config;
        this.policy = new MailRecipientPolicyService(
          mysql,
          rules,
          departments,
          hr,
        );
        const sender = new GuardedInvitationMailSender(
          config,
          this.policy,
          this.adapter,
        );
        this.guarded ??= sender;
        return sender;
      },
    });
  }

  async seed(mysql: MysqlService): Promise<void> {
    const manager = mysql.getManager();
    await manager.save(
      MailRecipientWhitelist,
      manager.create(MailRecipientWhitelist, {
        type: 'department',
        value: this.department,
        remark: '限本測試明確登錄的合成人資員工',
      }),
    );
  }

  async cleanup(mysql: MysqlService): Promise<void> {
    await mysql
      .getManager()
      .delete(MailRecipientWhitelist, {
        type: 'department',
        value: this.department,
      });
  }
}

export function mailFixture(ctx: {
  mail?: SyntheticMailFixture;
}): SyntheticMailFixture {
  if (!ctx.mail) throw new Error('此案例未啟用合成寄信 fixture');
  return ctx.mail;
}

/** 真實 queue/processor 使用相同的明確 HR 名單與政策，不呼叫真實上游。 */
export async function createSyntheticWorker(ctx: {
  mail?: SyntheticMailFixture;
}): Promise<INestApplicationContext> {
  const module = await mailFixture(ctx)
    .install(Test.createTestingModule({ imports: [WorkerModule] }))
    .compile();
  await module.init();
  return module;
}
