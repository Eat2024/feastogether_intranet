import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import type { HTTPMethods } from 'fastify';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { User } from '#app/features/users/entities/user.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignExportJob } from '#app/features/esign/entities/esign-export-job.entity';
import { EsignDraftService } from '#app/features/esign/services/esign-draft.service';
import { EsignCompletionAccessService } from '#app/features/esign/services/esign-completion-access.service';
import { EsignExportHistoryService } from '#app/features/esign/services/esign-export-history.service';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
} from './security-e2e.helper';
import {
  withAuthorizationDatabase,
  initializeAuthorizationOperator,
} from './helpers/authorization-fixtures';
import { createAuthorizationSession } from './helpers/authorization-http-fixtures';

const origin = 'http://localhost:3000';
describe('028 同仁電子簽入口與本人邊界', () => {
  jest.setTimeout(120_000);
  it('OAuth/WebView 同仁可閱讀同部門，建立／管理／候選人／一般匯出所有入口拒絕', async () => {
    await withAuthorizationDatabase(async (db) => {
      const { catalog } = await initializeAuthorizationOperator(db);
      await catalog.syncCatalog();
      const ctx = await createSecurityE2eApp(
        (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
        null,
      );
      try {
        const creator = await db.manager.save(
          User,
          db.manager.create(User, {
            empid: 'AZ-CREATOR',
            name: '合成建立者',
            departmentCode: 'A',
            departmentName: '合成甲部門',
          }),
        );
        const colleague = await db.manager.save(
          User,
          db.manager.create(User, {
            empid: 'AZ-COLLEAGUE',
            name: '合成同仁',
            departmentCode: 'A',
            departmentName: '合成甲部門',
          }),
        );
        const pdf = await PDFDocument.create();
        pdf.addPage();
        const document = await ctx.app
          .get(EsignDraftService)
          .create({
            title: '合成授權文件',
            creatorUserId: creator.id,
            bytes: Buffer.from(await pdf.save()),
            contentType: 'application/pdf',
            originalFileName: 'fixture.pdf',
          });
        const path = `/api/esign/documents/${document.id}`;
        const routes: Array<[HTTPMethods, string, object?]> = [
          ['POST', '/api/esign/documents'],
          ['PATCH', path],
          ['DELETE', path],
          ['PUT', `${path}/draftSave`],
          ['PATCH', `${path}/draft-settings`],
          ['PUT', `${path}/fields`],
          ['POST', `${path}/initiations`],
          ['POST', `${path}/reopenings`],
          ['POST', `${path}/stoppages`],
          ['GET', `${path}/reopening-invitations`],
          ['PATCH', `${path}/signers/${randomUUID()}/note`],
          ['GET', `${path}/initiation-jobs/latest`],
          ['GET', `${path}/initiation-jobs/${randomUUID()}`],
          ['GET', `${path}/initiation-jobs/${randomUUID()}/issues`],
          ['GET', `${path}/initiation-jobs/${randomUUID()}/input`],
          ['POST', `${path}/initiation-jobs/${randomUUID()}/retries`],
          ['GET', `${path}/notification-batches`],
          ['GET', `${path}/notification-batches/${randomUUID()}`],
          ['POST', `${path}/notification-batches`],
          ['GET', '/api/esign/signer-candidates'],
          ['GET', '/api/esign/signer-candidates/org-chart'],
          ['POST', '/api/esign/signer-candidates/resolutions'],
          ['GET', `${path}?view=export`],
          ['GET', '/api/esign/exportable-documents'],
          ['POST', `${path}/exports`],
          ['GET', `${path}/exports/${randomUUID()}`],
          ['POST', `${path}/exports/${randomUUID()}/retries`],
          ['GET', `${path}/exports/${randomUUID()}/files/1`],
          ['POST', `${path}/export-downloads`, { type: 'excel' }],
          [
            'POST',
            `${path}/export-downloads`,
            { type: 'zip', exportId: randomUUID(), fileId: '1' },
          ],
          ['GET', '/api/esign/history/export?type=excel'],
          ['POST', '/api/esign/history/export'],
          ['GET', `/api/esign/history/export/${randomUUID()}/document`],
          ['POST', `/api/esign/history/export/${randomUUID()}/downloads`],
        ];
        for (const source of ['oauth', 'webview'] as const) {
          const cookie = await createAuthorizationSession(
            ctx.app,
            { kind: 'employee', userId: colleague.id },
            source,
          );
          for (const url of [
            '/api/esign/documents?role=dep',
            path,
            `${path}/source-file`,
          ]) {
            const response = await ctx.app.inject({
              method: 'GET',
              url,
              headers: { cookie },
            });
            expect({ url, status: response.statusCode }).toEqual({
              url,
              status: 200,
            });
          }
          const detail = await ctx.app.inject({
            method: 'GET',
            url: path,
            headers: { cookie },
          });
          expect(
            detail.json<{ data: { canExport: boolean } }>().data.canExport,
          ).toBe(false);
          for (const [method, url, payload] of routes) {
            const response = await ctx.app.inject({
              method,
              url,
              headers: { cookie, origin },
              payload,
            });
            expect({
              method,
              url,
              status: response.statusCode,
              code: response.json<{ error: { code: string } }>().error?.code,
            }).toEqual({
              method,
              url,
              status: 403,
              code: 'AUTHORIZATION_DENIED',
            });
          }
          await db.manager.update(User, colleague.id, { departmentCode: 'B' });
          expect(
            (
              await ctx.app.inject({
                method: 'GET',
                url: path,
                headers: { cookie },
              })
            ).statusCode,
          ).toBe(404);
          await db.manager.update(User, colleague.id, { departmentCode: 'A' });
        }
      } finally {
        await closeSecurityE2eApp(ctx);
      }
    });
  });
});

it('跨部門／缺部門的本人副本獨立判斷；建立人與管理員也不能取他人副本或由pdf歷史繞過', async () => {
  await withAuthorizationDatabase(async (db) => {
    const { catalog } = await initializeAuthorizationOperator(db);
    await catalog.syncCatalog();
    const ctx = await createSecurityE2eApp(
      (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
      null,
    );
    try {
      const owner = await db.manager.save(
        User,
        db.manager.create(User, {
          empid: 'AZ-OWNER',
          name: '合成本人',
          departmentCode: null,
        }),
      );
      const creator = await db.manager.save(
        User,
        db.manager.create(User, {
          empid: 'AZ-MANAGER',
          name: '合成管理員',
          departmentCode: 'A',
        }),
      );
      await db.query(
        "INSERT INTO authorization_user_roles (module_key,user_id,role_id) SELECT 'esign', ?, id FROM authorization_roles WHERE role_code='esign_admin'",
        [creator.id],
      );
      await db.query(
        "INSERT INTO authorization_user_roles (module_key,user_id,role_id) SELECT 'esign', ?, id FROM authorization_roles WHERE role_code='document_creator'",
        [owner.id],
      );
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const document = await ctx.app
        .get(EsignDraftService)
        .create({
          title: '合成副本文件',
          creatorUserId: creator.id,
          bytes: Buffer.from(await pdf.save()),
          contentType: 'application/pdf',
          originalFileName: 'copy.pdf',
        });
      await db.query(
        "UPDATE esign_documents SET status='active',sign_start_at=?,sign_end_at=? WHERE id=?",
        [
          new Date(Date.now() - 60000),
          new Date(Date.now() + 86400000),
          document.id,
        ],
      );
      const signer = await db.manager.save(
        EsignSigner,
        db.manager.create(EsignSigner, {
          documentId: document.id,
          publicId: randomUUID(),
          signerType: 'user',
          userId: owner.id,
          empidSnapshot: owner.empid,
          nameSnapshot: owner.name,
          status: 'signed',
          signedAt: new Date(),
          completionStatus: 'pending',
          sortOrder: 0,
        }),
      );
      const history = await db.manager.save(
        EsignExportJob,
        db.manager.create(EsignExportJob, {
          publicId: randomUUID(),
          documentId: document.id,
          createdByUserId: owner.id,
          exportType: 'pdf',
          scopeDescription: '合成本人副本',
          signerId: signer.id,
          status: 'completed',
          recordCount: 1,
          completedAt: new Date(),
        }),
      );
      const completions = ctx.app.get(EsignCompletionAccessService);
      const histories = ctx.app.get(EsignExportHistoryService);
      await expect(
        completions.departmentFile(document.id, signer.publicId, creator.id),
      ).rejects.toMatchObject({ code: 'ESIGN_RESOURCE_NOT_FOUND' });
      await expect(
        histories.redownloadPdf(history.publicId!, creator.id),
      ).rejects.toMatchObject({ code: 'ESIGN_RESOURCE_NOT_FOUND' });
      await expect(
        completions.departmentFile(document.id, signer.publicId, owner.id),
      ).resolves.toMatchObject({ file: null });
      await expect(
        histories.redownloadPdf(history.publicId!, owner.id),
      ).rejects.toMatchObject({
        code: 'ESIGN_STATE_CONFLICT',
        message: '個人副本尚未產生',
      });
      for (const actor of [
        { kind: 'employee', userId: creator.id },
        { kind: 'super_user' },
      ] as const) {
        const cookie = await createAuthorizationSession(ctx.app, actor);
        for (const url of [
          `/api/esign/documents/${document.id}/signers/${signer.publicId}/completed-file/downloads`,
          `/api/esign/history/export/${history.publicId}/downloads`,
          `/api/esign/signing-tasks/${signer.publicId}/completed-file/downloads`,
          `/api/esign/signing-tasks/${signer.publicId}/signatures`,
          `/api/esign/signing-tasks/${signer.publicId}/rejection`,
        ]) {
          const response = await ctx.app.inject({
            method: 'POST',
            url,
            headers: { cookie, origin },
            payload: url.endsWith('/signatures')
              ? {
                  requestId: randomUUID(),
                  consentVersion: '1',
                  accepted: true,
                  signatures: [
                    { fieldId: '1', pngDataUrl: 'data:image/png;base64,aA==' },
                  ],
                }
              : url.endsWith('/rejection')
                ? { requestId: randomUUID() }
                : undefined,
          });
          expect(response.statusCode).toBe(
            actor.kind === 'super_user' ? 403 : 404,
          );
        }
      }
    } finally {
      await closeSecurityE2eApp(ctx);
    }
  });
});

it('匯出read/create互不替代：詳情view與下載準備在service依實際分支驗權', async () => {
  await withAuthorizationDatabase(async (db) => {
    const { catalog, repository } = await initializeAuthorizationOperator(db);
    await catalog.syncCatalog();
    const ctx = await createSecurityE2eApp(
      (b) => b.overrideProvider(MYSQL_MAIN).useValue(db),
      null,
    );
    try {
      const user = await db.manager.save(
        User,
        db.manager.create(User, {
          empid: 'AZ-EXPORT',
          name: '合成匯出員工',
          departmentCode: 'A',
        }),
      );
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const document = await ctx.app
        .get(EsignDraftService)
        .create({
          title: '合成分支文件',
          creatorUserId: user.id,
          bytes: Buffer.from(await pdf.save()),
          contentType: 'application/pdf',
          originalFileName: 'export.pdf',
        });
      await db.query(
        "UPDATE esign_documents SET status='active',sign_start_at=?,sign_end_at=? WHERE id=?",
        [
          new Date(Date.now() - 60000),
          new Date(Date.now() + 86400000),
          document.id,
        ],
      );
      const role = (await repository.roles(db.manager)).find(
        (r) => r.roleCode === 'document_creator',
      )!;
      const permissions = await repository.permissions(db.manager);
      await db.query(
        "INSERT INTO authorization_user_roles (module_key,user_id,role_id) VALUES ('esign',?,?)",
        [user.id, role.id],
      );
      const cookie = await createAuthorizationSession(ctx.app, {
        kind: 'employee',
        userId: user.id,
      });
      const path = `/api/esign/documents/${document.id}`;
      for (const permission of ['esign.export.read', 'esign.export.create']) {
        await db.transaction(async (manager) => {
          await repository.replaceRolePermissions(
            role,
            [permissions.find((p) => p.permissionKey === permission)!.id],
            manager,
          );
        });
        const detail = await ctx.app.inject({
          method: 'GET',
          url: `${path}?view=export`,
          headers: { cookie },
        });
        expect(detail.statusCode).toBe(
          permission === 'esign.export.read' ? 200 : 403,
        );
        for (const type of ['excel', 'zip']) {
          const response = await ctx.app.inject({
            method: 'POST',
            url: `${path}/export-downloads`,
            headers: { cookie, origin },
            payload:
              type === 'excel'
                ? { type }
                : { type, exportId: randomUUID(), fileId: '1' },
          });
          expect({ permission, type, status: response.statusCode }).toEqual({
            permission,
            type,
            status:
              permission === 'esign.export.read'
                ? type === 'excel'
                  ? 403
                  : 404
                : type === 'excel'
                  ? 200
                  : 403,
          });
        }
      }
    } finally {
      await closeSecurityE2eApp(ctx);
    }
  });
});
