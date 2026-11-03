import request, { type Response } from 'supertest';
import { EsignInitiationJob } from '#app/features/esign/entities/esign-initiation-job.entity';
import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';
import type { InitiationJobDto } from '#app/features/esign/dto/initiation-job.dto';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { apiData } from '../api-response.helper';
import type { SecurityE2eContext } from '../security-e2e.helper';

/** 只驅動已由 HTTP 受理的工作；沿用 app 真實依賴與既有故障 spies。 */
export async function driveInitiation(
  ctx: SecurityE2eContext,
  accepted: Response,
  cookie: string,
): Promise<InitiationJobDto> {
  expect(accepted.status).toBe(202);
  const summary = apiData<InitiationJobDto>(accepted);
  const job = await ctx.app
    .get(MysqlService)
    .getManager()
    .findOneByOrFail(EsignInitiationJob, { publicId: summary.jobId });
  await ctx.app.get(EsignInitiationJobService).process(job.id);
  return apiData<InitiationJobDto>(
    await request(ctx.server)
      .get(
        `/api/esign/documents/${summary.documentId}/initiation-jobs/${summary.jobId}`,
      )
      .set('Cookie', cookie)
      .expect(200),
  );
}

/** 成功 fixture 的詳細資料來自獨立 GET，沒有偽造同步發起回應。 */
export async function completeInitiation(
  ctx: SecurityE2eContext,
  acceptance: PromiseLike<Response>,
  cookie: string,
): Promise<Response> {
  const job = await driveInitiation(ctx, await acceptance, cookie);
  expect(job).toMatchObject({ status: 'succeeded', errorCode: null });
  return request(ctx.server)
    .get(`/api/esign/documents/${job.documentId}`)
    .set('Cookie', cookie)
    .expect(200);
}

/** 僅刪除該 fixture 文件工作；重試子工作 ID 較大，先子後父解除 FK。 */
export async function deleteInitiationJobs(
  manager: Pick<import('typeorm').EntityManager, 'query'>,
  documentId: string | number,
): Promise<void> {
  const jobs = await manager.query<Array<{ id: number }>>(
    'SELECT id FROM esign_initiation_jobs WHERE document_id=? ORDER BY id DESC',
    [documentId],
  );
  for (const job of jobs)
    await manager.query('DELETE FROM esign_initiation_jobs WHERE id=?', [
      job.id,
    ]);
}

/** 故障回歸略過30/120秒退避；保留真實 claim 次數、交易與終態判定。 */
export async function exhaustInitiationRetries(
  ctx: SecurityE2eContext,
  accepted: Response,
  cookie: string,
): Promise<InitiationJobDto> {
  let state = await driveInitiation(ctx, accepted, cookie);
  for (let attempt = 1; state.status === 'queued' && attempt < 3; attempt++) {
    expect(state.nextAttemptAt).not.toBeNull();
    await ctx.app
      .get(MysqlService)
      .getManager()
      .update(
        EsignInitiationJob,
        { publicId: state.jobId },
        { nextAttemptAt: new Date(Date.now() - 1000) },
      );
    state = await driveInitiation(ctx, accepted, cookie);
  }
  expect(state.status).toBe('failed');
  return state;
}
