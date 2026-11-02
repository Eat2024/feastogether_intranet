// 僅在固定隔離資料庫執行；使用編譯後的正式 repository 與 migration。
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const req = createRequire(resolve(__dirname, "../../server/package.json"));
req("reflect-metadata");
const mysql = req("mysql2/promise");
const { DataSource } = req("typeorm");
const { buildMysqlOptions } = req(
  "./dist/infrastructure/database/mysql/mysql.options",
);
const { DocumentRepository } = req(
  "./dist/features/esign/repositories/document.repository",
);
const { ExportJobRepository } = req(
  "./dist/features/esign/repositories/export-job.repository",
);
const database = "feastogether_intranet_test017perf";
const connection = {
  host: "127.0.0.1",
  port: 13317,
  user: "root",
  password: "",
};
(async () => {
  const admin = await mysql.createConnection(connection);
  // 不覆蓋任何既有 DB；重跑前自行確認並移除本腳本建立的隔離 DB。
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await admin.end();
  const env = {
    DB_MYSQL_HOST: connection.host,
    DB_MYSQL_PORT: String(connection.port),
    DB_MYSQL_USER: connection.user,
    DB_MYSQL_PASS: "",
    DB_MYSQL_DB: database,
  };
  let captured = [];
  const logger = {
    logQuery: (sql, parameters) => captured.push({ sql, parameters }),
    logQueryError() {},
    logQuerySlow() {},
    logSchemaBuild() {},
    logMigration() {},
    log() {},
  };
  const ds = await new DataSource({
    ...buildMysqlOptions((key) => env[key]),
    logging: ["query"],
    logger,
  }).initialize();
  try {
    await ds.runMigrations();
    await ds.query(
      "INSERT INTO users (empid,name,department_code) VALUES ('PERF017','合成效能員工','D000')",
    );
    // 20,000 文件 / 100 部門；每部門 200 筆，其中 20 筆軟刪除。另加 NULL 與大小寫差異快照。
    for (let start = 0; start < 20000; start += 500) {
      const values = Array.from({ length: 500 }, (_, n) => {
        const i = start + n;
        return [
          i + 1,
          `PERF-${i}`,
          "合成效能文件",
          "active",
          1,
          `D${String(i % 100).padStart(3, "0")}`,
          i % 1000 < 100 ? "2026-01-01" : null,
          new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        ];
      });
      await ds.query(
        "INSERT INTO esign_documents (id,doc_number,title,status,created_by_user_id,created_by_department_code,deleted_at,updated_at,sign_start_at,sign_end_at) VALUES " +
          values
            .map(() => "(?,?,?,?,?,?,?,?,'2026-01-01','2027-01-01')")
            .join(","),
        values.flat(),
      );
    }
    await ds.query(
      "INSERT INTO esign_documents (id,doc_number,title,status,created_by_user_id,created_by_department_code,sign_start_at,sign_end_at) VALUES (20001,'PERF-NULL','合成NULL','active',1,NULL,'2026-01-01','2027-01-01'),(20002,'PERF-CASE','合成大小寫','active',1,'d000','2026-01-01','2027-01-01')",
    );
    await ds.query(
      "INSERT INTO esign_signers (id,public_id,document_id,signer_type,email,name_snapshot) SELECT id,UUID(),id,'email','synthetic@example.test','合成簽署人' FROM esign_documents",
    );
    // 各文件 2 Excel、1 PDF、1 有快照 ZIP、1 無快照 ZIP（必須排除）。PDF 使用外部下載的 NULL exporter。
    for (let start = 1; start <= 20002; start += 500) {
      const values = [];
      for (let id = start; id < Math.min(start + 500, 20003); id++) {
        for (let k = 0; k < 5; k++)
          values.push([
            `00000000-0000-0000-${String(k).padStart(4, "0")}-${String(id).padStart(12, "0")}`,
            ["excel", "excel", "pdf", "signed_copies_zip", "signed_copies_zip"][
              k
            ],
            id,
            k === 2 ? null : 1,
            k === 2 ? id : null,
            k < 2 ? '{"statuses":[],"depts":[],"fields":[]}' : null,
            "completed",
            "合成效能匯出",
            k === 3 ? "[]" : null,
            new Date(Date.UTC(2026, 0, 1, 0, 0, id * 5 + k)),
          ]);
      }
      await ds.query(
        "INSERT INTO esign_export_jobs (public_id,export_type,document_id,created_by_user_id,signer_id,conditions_json,status,scope_description,snapshot_json,created_at) VALUES " +
          values.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(","),
        values.flat(),
      );
    }
    await ds.query("ANALYZE TABLE esign_documents, esign_export_jobs");
    const documentRepo = new DocumentRepository();
    const exportsRepo = new ExportJobRepository();
    const plans = [];
    async function measure(name, operation) {
      captured = [];
      const start = performance.now();
      const result = await operation();
      const milliseconds = +(performance.now() - start).toFixed(2);
      const queries = captured.slice();
      for (const query of queries) {
        const plan = await ds.query("EXPLAIN " + query.sql, query.parameters);
        plans.push({ name, milliseconds, ...query, plan });
      }
      return result;
    }
    const dep = await measure("dep列表", () =>
      documentRepo.findByDepartment("D000", ds.manager),
    );
    assert.equal(dep.length, 180);
    assert.ok(
      dep.every(
        (doc) =>
          doc.createdByDepartmentCode === "D000" && doc.deletedAt === null,
      ),
    );
    const types = ["excel", "pdf", "signed_copies_zip"];
    const counts = await measure("history分組count", () =>
      exportsRepo.historyCounts(types, undefined, "D000", ds.manager),
    );
    assert.deepEqual(Object.fromEntries(counts), {
      excel: 360,
      pdf: 180,
      signed_copies_zip: 180,
    });
    const consistency = [];
    for (const exportType of types) {
      const seen = [];
      for (let offset = 0; offset < counts.get(exportType); offset += 50) {
        const query = { departmentCode: "D000", exportType, offset, limit: 50 };
        const operation = () => exportsRepo.historyPage(query, ds.manager);
        const page =
          offset === 0
            ? await measure(`history-${exportType}-page`, operation)
            : await operation();
        seen.push(...page);
      }
      assert.equal(seen.length, counts.get(exportType));
      assert.equal(new Set(seen.map((row) => row.id)).size, seen.length);
      assert.ok(
        seen.every(
          (row) =>
            row.documentId <= 20000 &&
            (row.documentId - 1) % 100 === 0 &&
            (row.documentId - 1) % 1000 >= 100,
        ),
      );
      consistency.push({
        exportType,
        count: counts.get(exportType),
        paginatedRows: seen.length,
      });
    }
    const single = await measure("history單文件count", () =>
      exportsRepo.historyCounts(types, 101, "D000", ds.manager),
    );
    assert.deepEqual(Object.fromEntries(single), {
      excel: 2,
      pdf: 1,
      signed_copies_zip: 1,
    });
    await measure("history單文件page", () =>
      exportsRepo.historyPage(
        {
          departmentCode: "D000",
          documentId: 101,
          exportType: "excel",
          offset: 0,
          limit: 50,
        },
        ds.manager,
      ),
    );
    assert.equal(
      (await exportsRepo.historyCounts(types, 102, "D000", ds.manager)).size,
      0,
    );
    console.log(
      JSON.stringify(
        {
          database,
          mysql: await ds.query("SELECT VERSION() version"),
          documents: 20002,
          jobs: 100010,
          depRows: dep.length,
          consistency,
          plans,
        },
        null,
        2,
      ),
    );
  } finally {
    await ds.destroy();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
