import { withAuthorizationDatabase } from './helpers/authorization-fixtures';
import { revertAfter } from './schema-migration.helper';

describe('028 生命週期 actor schema', () => {
  jest.setTimeout(120_000);
  it('歷史工作回填 employee、無通知員工回填 system；非法組合拒絕且新 actor 阻擋回退', async () => {
    await withAuthorizationDatabase(async (db) => {
      await revertAfter(db, 'EsignLifecycleActors1793923202000');
      await db.undoLastMigration();
      await db.query(
        "INSERT INTO users(id,empid,name) VALUES(1,'LIFE-HISTORY','合成人員')",
      );
      await db.query(
        "INSERT INTO esign_documents(id,doc_number,title,created_by_user_id) VALUES(1,UUID(),'合成歷史文件',1)",
      );
      await db.query(
        "INSERT INTO esign_initiation_jobs(public_id,document_id,created_by_user_id,request_key,request_hash,input_json,document_version_json,total_count,accepted_at,deadline_at) VALUES(UUID(),1,1,UUID(),REPEAT('a',64),'{}','{}',1,NOW(6),DATE_ADD(NOW(6),INTERVAL 1 HOUR))",
      );
      await db.query(
        "INSERT INTO esign_notification_batches(id,document_id,filter_type,target_count,notified_by_user_id) VALUES(1,1,'external_invitation',1,1),(2,1,'external_invitation',1,NULL)",
      );
      await db.runMigrations();
      expect(
        await db.query(
          'SELECT created_by_actor_kind,created_by_user_id FROM esign_initiation_jobs',
        ),
      ).toEqual([{ created_by_actor_kind: 'employee', created_by_user_id: 1 }]);
      expect(
        await db.query(
          'SELECT notified_by_actor_kind,notified_by_user_id FROM esign_notification_batches ORDER BY id',
        ),
      ).toEqual([
        { notified_by_actor_kind: 'employee', notified_by_user_id: 1 },
        { notified_by_actor_kind: 'system', notified_by_user_id: null },
      ]);
      expect((await db.driver.createSchemaBuilder().log()).upQueries).toEqual(
        [],
      );
      for (const [kind, user] of [
        ['employee', null],
        ['super_user', 1],
        ['system', null],
        ['invalid', null],
      ]) {
        await expect(
          db.query(
            'UPDATE esign_initiation_jobs SET created_by_actor_kind=?,created_by_user_id=?',
            [kind, user],
          ),
        ).rejects.toThrow();
      }
      for (const [kind, user] of [
        ['employee', null],
        ['super_user', 1],
        ['system', 1],
        ['legacy_unknown', null],
        ['invalid', null],
      ]) {
        await expect(
          db.query(
            'UPDATE esign_notification_batches SET notified_by_actor_kind=?,notified_by_user_id=? WHERE id=1',
            [kind, user],
          ),
        ).rejects.toThrow();
      }
      await db.undoLastMigration();
      await db.runMigrations();
      await db.query(
        "UPDATE esign_initiation_jobs SET created_by_actor_kind='super_user',created_by_user_id=NULL",
      );
      await expect(db.undoLastMigration()).rejects.toThrow('無法回滾');
      await db.query(
        "UPDATE esign_initiation_jobs SET created_by_actor_kind='employee',created_by_user_id=1",
      );
      await db.query(
        "UPDATE esign_notification_batches SET notified_by_actor_kind='super_user',notified_by_user_id=NULL WHERE id=1",
      );
      await expect(db.undoLastMigration()).rejects.toThrow('無法回滾');
    });
  });
});
