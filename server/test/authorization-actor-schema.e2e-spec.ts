import { withAuthorizationDatabase } from './helpers/authorization-fixtures';

describe('028 文件 actor schema', () => {
  jest.setTimeout(120_000);
  it('空庫回退再套用；歷史稽核精準回填且簽署關聯、雜湊與證據保持', async () => {
    await withAuthorizationDatabase(async (db) => {
      await db.undoLastMigration();
      await db.query(
        "INSERT INTO users (id,empid,name) VALUES (1,'HISTORY-1','合成人員')",
      );
      await db.query(
        "INSERT INTO esign_documents (id,doc_number,title,created_by_user_id,created_by_department_code,signing_payload_sha256) VALUES (1,UUID(),'歷史文件',1,'A',REPEAT('a',64))",
      );
      await db.query(
        "INSERT INTO esign_document_fields (id,document_id,field_type,page_number,x_percent,y_percent,width_percent,height_percent,created_by_user_id) VALUES (1,1,'signature',1,0,0,10,10,1)",
      );
      await db.query(
        "INSERT INTO esign_signers (id,public_id,document_id,signer_type,user_id,name_snapshot,empid_snapshot,updated_by_user_id) VALUES (1,UUID(),1,'user',1,'合成簽署人','HISTORY-1',1)",
      );
      await db.query(
        "INSERT INTO esign_signature_records (signer_id,document_sha256,signing_payload_sha256,consent_version,authentication_method,authentication_event_id,signed_at_utc) VALUES (1,REPEAT('a',64),REPEAT('b',64),'v1','employee','synthetic-event',NOW(6))",
      );
      const evidence: unknown = await db.query(
        'SELECT * FROM esign_signature_records',
      );
      await db.runMigrations();
      expect(
        await db.query(
          'SELECT created_by_actor_kind,updated_by_actor_kind,updated_by_user_id,created_by_department_code,signing_payload_sha256 FROM esign_documents',
        ),
      ).toEqual([
        {
          created_by_actor_kind: 'employee',
          updated_by_actor_kind: null,
          updated_by_user_id: null,
          created_by_department_code: 'A',
          signing_payload_sha256: 'a'.repeat(64),
        },
      ]);
      expect(
        await db.query(
          'SELECT created_by_actor_kind,updated_by_actor_kind FROM esign_document_fields',
        ),
      ).toEqual([
        {
          created_by_actor_kind: 'employee',
          updated_by_actor_kind: 'legacy_unknown',
        },
      ]);
      expect(
        await db.query(
          'SELECT created_by_actor_kind,updated_by_actor_kind,user_id FROM esign_signers',
        ),
      ).toEqual([
        {
          created_by_actor_kind: 'legacy_unknown',
          updated_by_actor_kind: 'employee',
          user_id: 1,
        },
      ]);
      expect(await db.query('SELECT * FROM esign_signature_records')).toEqual(
        evidence,
      );
      await db.undoLastMigration();
      await db.runMigrations();
      expect(await db.query('SELECT * FROM esign_signature_records')).toEqual(
        evidence,
      );
      expect((await db.driver.createSchemaBuilder().log()).upQueries).toEqual(
        [],
      );
      for (const table of ['esign_document_fields', 'esign_signers']) {
        for (const slot of ['created', 'updated']) {
          for (const [kind, user] of [
            ['employee', null],
            ['super_user', 1],
            ['system', 1],
            ['legacy_unknown', 1],
            [null, null],
            ['invalid', null],
          ]) {
            await expect(
              db.query(
                `UPDATE ${table} SET ${slot}_by_actor_kind=?,${slot}_by_user_id=? WHERE id=1`,
                [kind, user],
              ),
            ).rejects.toThrow();
          }
          for (const kind of ['super_user', 'system', 'legacy_unknown'])
            await db.query(
              `UPDATE ${table} SET ${slot}_by_actor_kind=?,${slot}_by_user_id=NULL WHERE id=1`,
              [kind],
            );
          await db.query(
            `UPDATE ${table} SET ${slot}_by_actor_kind='employee',${slot}_by_user_id=1 WHERE id=1`,
          );
        }
      }
      await db.query(
        "UPDATE esign_signers SET updated_by_actor_kind='super_user',updated_by_user_id=NULL WHERE id=1",
      );
      await expect(db.undoLastMigration()).rejects.toThrow('無法回滾');
    });
  });
  it('Super 建立人必須沒有員工 FK，員工必須有 FK；新管理 metadata 阻擋破壞回退', async () => {
    await withAuthorizationDatabase(async (db) => {
      await db.query(
        "INSERT INTO users (id,empid,name) VALUES (1,'ACTOR-1','合成員工')",
      );
      await db.query(
        "INSERT INTO esign_documents (id,doc_number,title,created_by_actor_kind,created_by_user_id) VALUES (1,UUID(),'Super 文件','super_user',NULL)",
      );
      await expect(
        db.query('UPDATE esign_documents SET created_by_user_id=1 WHERE id=1'),
      ).rejects.toThrow();
      await expect(
        db.query(
          "UPDATE esign_documents SET created_by_actor_kind='employee' WHERE id=1",
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          'UPDATE esign_documents SET updated_by_actor_kind=NULL,updated_by_user_id=1 WHERE id=1',
        ),
      ).rejects.toThrow();
      await expect(db.undoLastMigration()).rejects.toThrow('無法回滾');
      expect((await db.driver.createSchemaBuilder().log()).upQueries).toEqual(
        [],
      );
    });
  });
});
