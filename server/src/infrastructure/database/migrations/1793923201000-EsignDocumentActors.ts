import type { MigrationInterface, QueryRunner } from 'typeorm';
/** 局部管理操作者，不改指定簽署人與簽章證據。 */
export class EsignDocumentActors1793923201000 implements MigrationInterface {
  name = 'EsignDocumentActors1793923201000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "ALTER TABLE esign_documents MODIFY created_by_user_id BIGINT NULL COMMENT '建立人 ID', ADD created_by_actor_kind VARCHAR(20) NOT NULL DEFAULT 'employee' COMMENT '建立操作者種類', ADD updated_by_actor_kind VARCHAR(20) NULL COMMENT '最後管理操作者種類', ADD updated_by_user_id BIGINT NULL COMMENT '最後管理員工 ID', ADD CONSTRAINT fk_esign_documents_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT",
    );
    await q.query(
      "ALTER TABLE esign_documents ADD CONSTRAINT chk_esign_documents_created_actor CHECK ((created_by_actor_kind='employee' AND created_by_user_id IS NOT NULL) OR (created_by_actor_kind='super_user' AND created_by_user_id IS NULL)), ADD CONSTRAINT chk_esign_documents_updated_actor CHECK ((updated_by_actor_kind IS NULL AND updated_by_user_id IS NULL) OR (updated_by_actor_kind IS NOT NULL AND ((updated_by_actor_kind='employee' AND updated_by_user_id IS NOT NULL) OR (updated_by_actor_kind='super_user' AND updated_by_user_id IS NULL))))",
    );
    for (const table of ['esign_document_fields', 'esign_signers']) {
      await q.query(
        `ALTER TABLE ${table} ADD created_by_actor_kind VARCHAR(20) NOT NULL DEFAULT 'system' COMMENT '建立操作者種類', ADD updated_by_actor_kind VARCHAR(20) NOT NULL DEFAULT 'system' COMMENT '更新操作者種類'`,
      );
      await q.query(
        `UPDATE ${table} SET created_by_actor_kind=IF(created_by_user_id IS NULL,'legacy_unknown','employee'), updated_by_actor_kind=IF(updated_by_user_id IS NULL,'legacy_unknown','employee')`,
      );
      for (const slot of ['created', 'updated'])
        await q.query(
          `ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_${slot}_actor CHECK ((${slot}_by_actor_kind='employee' AND ${slot}_by_user_id IS NOT NULL) OR (${slot}_by_actor_kind IN ('super_user','system','legacy_unknown') AND ${slot}_by_user_id IS NULL))`,
        );
    }
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = (await q.query(
      "SELECT (SELECT COUNT(*) FROM esign_documents WHERE created_by_actor_kind='super_user' OR updated_by_actor_kind IS NOT NULL)+(SELECT COUNT(*) FROM authorization_events)+(SELECT COUNT(*) FROM esign_document_fields WHERE created_by_actor_kind='super_user' OR updated_by_actor_kind='super_user')+(SELECT COUNT(*) FROM esign_signers WHERE created_by_actor_kind='super_user' OR updated_by_actor_kind='super_user') AS total",
    )) as Array<{ total: number }>;
    if (Number(row.total) > 0)
      throw new Error('無法回滾：管理操作者或授權稽核必須保留');
    for (const table of ['esign_document_fields', 'esign_signers'])
      await q.query(
        `ALTER TABLE ${table} DROP CHECK chk_${table}_created_actor, DROP CHECK chk_${table}_updated_actor, DROP COLUMN created_by_actor_kind, DROP COLUMN updated_by_actor_kind`,
      );
    await q.query(
      'ALTER TABLE esign_documents DROP CHECK chk_esign_documents_created_actor, DROP CHECK chk_esign_documents_updated_actor, DROP FOREIGN KEY fk_esign_documents_updated_by, DROP COLUMN updated_by_user_id, DROP COLUMN updated_by_actor_kind, DROP COLUMN created_by_actor_kind, DROP FOREIGN KEY fk_esign_documents_creator',
    );
    await q.query(
      "ALTER TABLE esign_documents MODIFY created_by_user_id BIGINT NOT NULL COMMENT '建立人 ID', ADD CONSTRAINT fk_esign_documents_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT",
    );
  }
}
