import { withAuthorizationDatabase } from './helpers/authorization-fixtures';

it('匯出actor遷移回填外部本人，NULL-aware CHECK拒絕冒用與破壞性回退', async () => {
  await withAuthorizationDatabase(async (db) => {
    await db.undoLastMigration();
    await db.query(
      "INSERT INTO users(id,empid,name) VALUES(1,'SCHEMA028','合成員工')",
    );
    await db.query(
      "INSERT INTO esign_documents(id,doc_number,title,created_by_user_id,created_by_department_code) VALUES(1,UUID(),'歷史文件',1,'A')",
    );
    await db.query(
      "INSERT INTO esign_signers(id,document_id,public_id,signer_type,user_id,empid_snapshot,name_snapshot) VALUES(1,1,UUID(),'user',1,'SCHEMA028','員工')",
    );
    await db.query(
      "INSERT INTO esign_signers(id,document_id,public_id,signer_type,email,name_snapshot) VALUES(2,1,UUID(),'email','external@example.test','外部')",
    );
    await db.query(
      "INSERT INTO esign_export_jobs(scope_description,document_id,created_by_user_id,export_type,signer_id) VALUES('本人',1,1,'pdf',1),('本人',1,NULL,'pdf',2)",
    );
    await db.runMigrations();
    expect(
      await db.query(
        'SELECT created_by_actor_kind FROM esign_export_jobs ORDER BY id',
      ),
    ).toEqual([
      { created_by_actor_kind: 'employee' },
      { created_by_actor_kind: 'external_signer' },
    ]);
    for (const [kind, user, type, signer, conditions] of [
      ['super_user', null, 'pdf', 1, null],
      ['employee', null, 'excel', null, '{}'],
      ['super_user', 1, 'excel', null, '{}'],
      ['external_signer', null, 'signed_copies_zip', null, null],
      ['employee', 1, 'pdf', null, null],
    ])
      await expect(
        db.query(
          'INSERT INTO esign_export_jobs(scope_description,document_id,created_by_actor_kind,created_by_user_id,export_type,signer_id,conditions_json) VALUES("全部",1,?,?,?,?,?)',
          [kind, user, type, signer, conditions],
        ),
      ).rejects.toMatchObject({
        driverError: { code: 'ER_CHECK_CONSTRAINT_VIOLATED' },
      });
    await db.query(
      "INSERT INTO esign_export_jobs(scope_description,document_id,created_by_actor_kind,created_by_user_id,export_type,conditions_json) VALUES('全部',1,'super_user',NULL,'excel','{}')",
    );
    await expect(db.undoLastMigration()).rejects.toThrow(
      '匯出操作者或授權稽核必須保留',
    );
  });
}, 120000);
