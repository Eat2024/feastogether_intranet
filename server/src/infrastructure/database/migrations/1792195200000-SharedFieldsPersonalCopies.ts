import { type MigrationInterface, type QueryRunner } from 'typeorm';

/** 共用欄位與個人副本；僅改 metadata，不重算既有簽署證據或檔案。 */
export class SharedFieldsPersonalCopies1792195200000 implements MigrationInterface {
  name = 'SharedFieldsPersonalCopies1792195200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE esign_signers
 ADD completion_status VARCHAR(20) NULL COMMENT '個人副本產製狀態',
 ADD completion_lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '個人副本 worker lease UUID',
 ADD completion_lease_expires_at DATETIME(6) NULL COMMENT '個人副本 worker lease 到期時間',
 ADD completion_ready_at DATETIME(6) NULL COMMENT '個人副本完成時間',
 ADD INDEX idx_esign_signers_completion_lease_expires_at (completion_lease_expires_at),
 ADD INDEX idx_esign_signers_completion_ready_at (completion_ready_at),
 ADD INDEX idx_esign_signers_completion_status_id (completion_status,id),
 DROP INDEX uq_esign_signers_completion_receipt_sha256,
 DROP INDEX idx_esign_signers_completion_receipt_expires_at,
 DROP COLUMN completion_receipt_sha256,
 DROP COLUMN completion_receipt_expires_at`);
    await q.query(`UPDATE esign_file_objects f
 JOIN (SELECT s.document_id, MIN(r.id) record_id FROM esign_signers s
 JOIN esign_signature_records r ON r.signer_id=s.id
 WHERE s.deleted_at IS NULL GROUP BY s.document_id HAVING COUNT(*)=1) owner ON owner.document_id=f.document_id
 SET f.signature_record_id=owner.record_id, f.document_id=NULL
 WHERE f.file_purpose='completed_pdf' AND f.signature_record_id IS NULL`);
    await q.query(`UPDATE esign_signers s LEFT JOIN esign_signature_records r ON r.signer_id=s.id
 LEFT JOIN esign_file_objects f ON f.signature_record_id=r.id AND f.file_purpose='completed_pdf'
 SET s.completion_status=IF(f.id IS NULL,'pending','ready'), s.completion_ready_at=f.created_at
 WHERE s.status='signed' `);
    await q.query(
      `ALTER TABLE esign_signers ADD CONSTRAINT chk_esign_signers_completion CHECK ((\`status\` = 'pending' AND \`completion_status\` IS NULL AND \`completion_lease_token\` IS NULL AND \`completion_lease_expires_at\` IS NULL AND \`completion_ready_at\` IS NULL) OR (\`status\` = 'signed' AND \`completion_status\` IS NOT NULL AND ((\`completion_status\` IN ('pending','failed') AND \`completion_lease_token\` IS NULL AND \`completion_lease_expires_at\` IS NULL AND \`completion_ready_at\` IS NULL) OR (\`completion_status\` = 'processing' AND \`completion_lease_token\` IS NOT NULL AND \`completion_lease_expires_at\` IS NOT NULL AND \`completion_ready_at\` IS NULL) OR (\`completion_status\` = 'ready' AND \`completion_lease_token\` IS NULL AND \`completion_lease_expires_at\` IS NULL AND \`completion_ready_at\` IS NOT NULL))))`,
    );
    await q.query(`ALTER TABLE esign_document_fields DROP FOREIGN KEY fk_esign_document_fields_signer,
 DROP INDEX idx_esign_document_fields_signer_id, DROP COLUMN signer_id`);
    await q.query(`ALTER TABLE esign_documents DROP INDEX idx_esign_documents_finalization_lease_expires_at,
 DROP COLUMN finalization_lease_token, DROP COLUMN finalization_lease_expires_at`);
    await q.query(`ALTER TABLE esign_file_objects
 ADD completed_signature_record_id BIGINT GENERATED ALWAYS AS (CASE WHEN file_purpose='completed_pdf' THEN signature_record_id ELSE NULL END) VIRTUAL COMMENT '個人完成檔唯一簽署證據 ID',
 ADD UNIQUE INDEX uq_esign_file_objects_completed_signature (completed_signature_record_id),
 ADD CONSTRAINT chk_esign_file_objects_completed_owner CHECK (\`file_purpose\` <> 'completed_pdf' OR (((\`document_id\` IS NOT NULL AND \`signature_record_id\` IS NULL) OR (\`document_id\` IS NULL AND \`signature_record_id\` IS NOT NULL)) AND \`document_field_id\` IS NULL AND \`verification_record_id\` IS NULL AND \`export_job_id\` IS NULL)),
 ADD CONSTRAINT chk_esign_file_objects_source_owner CHECK (\`file_purpose\` <> 'source_pdf' OR (\`document_id\` IS NOT NULL AND \`signature_record_id\` IS NULL AND \`document_field_id\` IS NULL AND \`verification_record_id\` IS NULL AND \`export_job_id\` IS NULL))`);
    // TypeORM 以自己的 metadata 記錄 generated expression，避免 schema drift。
    await q.query(
      `INSERT INTO typeorm_metadata (type, \`schema\`, \`table\`, name, value) VALUES (?, DATABASE(), ?, ?, ?)`,
      [
        'GENERATED_COLUMN',
        'esign_file_objects',
        'completed_signature_record_id',
        "CASE WHEN `file_purpose` = 'completed_pdf' THEN `signature_record_id` ELSE NULL END",
      ],
    );
    await q.query(
      `ALTER TABLE esign_verification_records MODIFY final_pdf_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '最終 PDF SHA-256'`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    // 新模型形成證據後不可透過結構回滾遺失其歸屬。
    const rows = (await q.query(
      `SELECT COUNT(*) total FROM esign_signers WHERE completion_status IS NOT NULL`,
    )) as Array<{ total: string }>;
    if (Number(rows[0]?.total))
      throw new Error('已有個人簽署結果，不可回滾個人副本結構');
    await q.query(
      "DELETE FROM typeorm_metadata WHERE type='GENERATED_COLUMN' AND `schema`=DATABASE() AND `table`='esign_file_objects' AND name='completed_signature_record_id'",
    );
    await q.query(
      `ALTER TABLE esign_verification_records MODIFY final_pdf_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '最終 PDF SHA-256'`,
    );
    await q.query(`ALTER TABLE esign_file_objects DROP CHECK chk_esign_file_objects_completed_owner,
 DROP CHECK chk_esign_file_objects_source_owner, DROP INDEX uq_esign_file_objects_completed_signature,
 DROP COLUMN completed_signature_record_id`);
    await q.query(`ALTER TABLE esign_document_fields ADD signer_id BIGINT NULL COMMENT '欄位所屬簽署人 ID' AFTER document_id,
 ADD INDEX idx_esign_document_fields_signer_id (signer_id),
 ADD CONSTRAINT fk_esign_document_fields_signer FOREIGN KEY (signer_id) REFERENCES esign_signers(id) ON DELETE RESTRICT ON UPDATE NO ACTION`);
    await q.query(`ALTER TABLE esign_documents ADD finalization_lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '完成檔案 worker lease UUID' AFTER stop_reason,
 ADD finalization_lease_expires_at DATETIME(6) NULL COMMENT '完成檔案 worker lease 到期時間' AFTER finalization_lease_token,
 ADD INDEX idx_esign_documents_finalization_lease_expires_at (finalization_lease_expires_at)`);
    await q.query(`ALTER TABLE esign_signers DROP CHECK chk_esign_signers_completion,
 DROP INDEX idx_esign_signers_completion_lease_expires_at, DROP INDEX idx_esign_signers_completion_ready_at,
 DROP INDEX idx_esign_signers_completion_status_id,
 DROP COLUMN completion_status, DROP COLUMN completion_lease_token, DROP COLUMN completion_lease_expires_at, DROP COLUMN completion_ready_at,
 ADD completion_receipt_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '外部完成收據 token SHA-256' AFTER invitation_delivered_at,
 ADD completion_receipt_expires_at DATETIME(6) NULL COMMENT '外部完成收據到期時間' AFTER completion_receipt_sha256,
 ADD UNIQUE INDEX uq_esign_signers_completion_receipt_sha256 (completion_receipt_sha256),
 ADD INDEX idx_esign_signers_completion_receipt_expires_at (completion_receipt_expires_at)`);
  }
}
