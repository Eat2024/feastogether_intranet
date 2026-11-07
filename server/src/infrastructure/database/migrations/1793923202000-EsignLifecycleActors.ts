import type { MigrationInterface, QueryRunner } from 'typeorm';
/** 背景發起及通知保存真正受理操作者；保留既有關聯與證據。 */
export class EsignLifecycleActors1793923202000 implements MigrationInterface {
  name = 'EsignLifecycleActors1793923202000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "ALTER TABLE esign_initiation_jobs MODIFY created_by_user_id BIGINT NULL COMMENT '原發起者 ID', ADD created_by_actor_kind VARCHAR(20) NOT NULL DEFAULT 'employee' COMMENT '實際提交操作者種類', ADD CONSTRAINT chk_esign_initiation_jobs_actor CHECK ((created_by_actor_kind='employee' AND created_by_user_id IS NOT NULL) OR (created_by_actor_kind='super_user' AND created_by_user_id IS NULL))",
    );
    await q.query(
      "ALTER TABLE esign_notification_batches ADD notified_by_actor_kind VARCHAR(20) NOT NULL DEFAULT 'system' COMMENT '實際通知操作者種類'",
    );
    await q.query(
      "UPDATE esign_notification_batches SET notified_by_actor_kind=IF(notified_by_user_id IS NULL,'system','employee')",
    );
    await q.query(
      "ALTER TABLE esign_notification_batches ADD CONSTRAINT chk_esign_notification_batches_actor CHECK ((notified_by_actor_kind='employee' AND notified_by_user_id IS NOT NULL) OR (notified_by_actor_kind IN ('super_user','system') AND notified_by_user_id IS NULL))",
    );
  }
  async down(q: QueryRunner): Promise<void> {
    const [row]: Array<{ total: number }> = await q.query(
      "SELECT (SELECT COUNT(*) FROM audit_logs)+(SELECT COUNT(*) FROM esign_initiation_jobs WHERE created_by_actor_kind='super_user')+(SELECT COUNT(*) FROM esign_notification_batches WHERE notified_by_actor_kind='super_user') AS total",
    );
    if (Number(row.total) > 0)
      throw new Error('無法回滾：生命週期操作者或授權稽核必須保留');
    await q.query(
      'ALTER TABLE esign_notification_batches DROP CHECK chk_esign_notification_batches_actor, DROP COLUMN notified_by_actor_kind',
    );
    await q.query(
      'ALTER TABLE esign_initiation_jobs DROP CHECK chk_esign_initiation_jobs_actor, DROP COLUMN created_by_actor_kind, DROP FOREIGN KEY fk_esign_initiation_jobs_creator',
    );
    await q.query(
      "ALTER TABLE esign_initiation_jobs MODIFY created_by_user_id BIGINT NOT NULL COMMENT '原發起者 ID', ADD CONSTRAINT fk_esign_initiation_jobs_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT",
    );
  }
}
