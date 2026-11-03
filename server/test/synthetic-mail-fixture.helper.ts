import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { User } from '#app/features/users/entities/user.entity';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { GuardedInvitationMailSender } from '#app/infrastructure/mail/guarded-invitation-mail-sender.service';
import {
  INVITATION_MAIL_SENDER,
  type InvitationMailSender,
  type SendInvitationMailInput,
  type SendOtpMailInput,
  type SendInternalGroupMailInput,
} from '#app/infrastructure/mail/invitation-mail-sender.port';
import { MailRecipientPolicyService } from '#app/infrastructure/mail/mail-recipient-policy.service';
import { MailRecipientWhitelist } from '#app/infrastructure/mail/mail-recipient-whitelist.entity';
import { MailRecipientWhitelistRepository } from '#app/infrastructure/mail/mail-recipient-whitelist.repository';
import { WorkerModule } from '#app/worker.module';

/** 在寄送前寫入明確測試安排；政策仍讀取真實 DB，不從寄送輸入自動放行。 */
class FixtureGuardedSender extends GuardedInvitationMailSender {
  constructor(
    config: ConfigService,
    policy: MailRecipientPolicyService,
    adapter: InvitationMailSender,
    private readonly prepare: () => Promise<void>,
  ) {
    super(config, policy, adapter);
  }
  override async send(input: SendInvitationMailInput): Promise<void> {
    await this.prepare();
    return super.send(input);
  }
  override async sendOtp(input: SendOtpMailInput): Promise<void> {
    await this.prepare();
    return super.sendOtp(input);
  }
  override async sendInternalGroup(input: SendInternalGroupMailInput) {
    await this.prepare();
    return super.sendInternalGroup(input);
  }
}

/** 只有案例安排階段登錄的地址會建立獨立合成部門員工，不授權任意收件地址。 */
export class SyntheticMailFixture {
  readonly adapter = new FakeInvitationMailSender();
  private readonly department = `TESTMAIL${randomBytes(5).toString('hex')}`;
  private readonly staff = new Map<string, string>();
  private config?: ConfigService;
  private policy?: MailRecipientPolicyService;
  private guarded?: GuardedInvitationMailSender;
  private mysql?: MysqlService;
  private readonly persisted = new Set<string>();
  private flushing: Promise<void> = Promise.resolve();

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
    return new FixtureGuardedSender(this.config, this.policy, adapter, () =>
      this.flush(),
    );
  }

  private flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      if (!this.mysql) throw new Error('合成寄信 fixture 尚未初始化');
      const manager = this.mysql.getManager();
      const entries = [...this.staff].filter(
        ([empid]) => !this.persisted.has(empid),
      );
      for (let offset = 0; offset < entries.length; offset += 500) {
        const batch = entries.slice(offset, offset + 500);
        await manager.insert(
          User,
          batch.map(([empid, email]) => ({
            empid,
            email,
            name: '合成收件員工',
            isActive: true,
            departmentCode: this.department,
          })),
        );
        for (const [empid] of batch) this.persisted.add(empid);
      }
    });
    return this.flushing;
  }

  install(builder: TestingModuleBuilder): TestingModuleBuilder {
    return builder.overrideProvider(INVITATION_MAIL_SENDER).useFactory({
      inject: [
        ConfigService,
        MysqlService,
        MailRecipientWhitelistRepository,
        UserRepository,
      ],
      factory: (
        config: ConfigService,
        mysql: MysqlService,
        rules: MailRecipientWhitelistRepository,
        users: UserRepository,
      ) => {
        this.config ??= config;
        this.mysql ??= mysql;
        const policy = new MailRecipientPolicyService(mysql, rules, users);
        const sender = new FixtureGuardedSender(
          config,
          policy,
          this.adapter,
          () => this.flush(),
        );
        this.policy ??= policy;
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
        remark: '限本測試明確登錄的合成本機員工',
      }),
    );
  }

  async cleanup(mysql: MysqlService): Promise<void> {
    await this.flushing;
    await mysql.getManager().delete(User, { departmentCode: this.department });
    await mysql.getManager().delete(MailRecipientWhitelist, {
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

/** 真實 queue/processor 使用相同的明確本機名單與政策，不呼叫真實上游。 */
export async function createSyntheticWorker(ctx: {
  mail?: SyntheticMailFixture;
}): Promise<INestApplicationContext> {
  const module = await mailFixture(ctx)
    .install(Test.createTestingModule({ imports: [WorkerModule] }))
    .compile();
  await module.init();
  return module;
}
