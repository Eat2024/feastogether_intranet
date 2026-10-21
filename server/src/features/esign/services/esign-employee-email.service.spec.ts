import { of, Observable } from 'rxjs';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { FeastogetherClient } from '#app/infrastructure/http-client/feastogether/feastogether.client';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { DocumentRepository } from '../repositories/document.repository';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignEmployeeEmailService } from './esign-employee-email.service';

function fixture() {
  const manager = { find: jest.fn(), findOne: jest.fn() };
  manager.find.mockResolvedValue([
    { id: 1, empid: '001', isActive: true, deletedAt: null },
    { id: 2, empid: '002', isActive: true, deletedAt: null },
  ]);
  manager.findOne.mockResolvedValue({
    id: 10,
    createdByUserId: 1,
    status: 'draft',
    deletedAt: null,
  });
  const http = { post: jest.fn() };
  http.post.mockReturnValue(
    of({
      data: {
        success: true,
        data: [
          { person_empid: '002', email: 'shared@example.test' },
          { person_empid: '001', email: 'shared@example.test' },
        ],
      },
    }),
  );
  const client = new FeastogetherClient(
    http as never,
    { baseUrl: 'https://source.example.test', apiKey: 'synthetic' } as never,
    { warn: jest.fn() } as never,
  );
  const documents = new DocumentRepository();
  const validation = new EsignDocumentValidationService();
  const service = new EsignEmployeeEmailService(
    new MysqlService({ manager } as never),
    new UserRepository(),
    documents,
    new EsignAccessPolicyService(validation, documents),
    new FeastogetherHrService(client),
  );
  return { service, manager, http };
}

describe('草稿員工信箱核對', () => {
  it.each([1, 100, 101, 6000])(
    '完整核對 %i 位員工，每批不超過 100 且最多 4 批在途',
    async (count) => {
      const { service, http } = fixture();
      let active = 0;
      let peak = 0;
      const batchSizes: number[] = [];
      http.post.mockImplementation(
        (_url: string, body: { person_empids: string[] }) =>
          new Observable((subscriber) => {
            active++;
            peak = Math.max(peak, active);
            batchSizes.push(body.person_empids.length);
            queueMicrotask(() => {
              active--;
              subscriber.next({
                data: {
                  success: true,
                  data: body.person_empids.toReversed().map((id) => ({
                    person_empid: id,
                    email: `${id}@example.test`,
                  })),
                },
              });
              subscriber.complete();
            });
          }),
      );
      const identities = Array.from({ length: count }, (_, i) => ({
        userId: i + 1,
        empid: `E${i + 1}`,
      }));
      const result = await service.lookupEmails(identities);
      expect(result).toHaveLength(count);
      expect(result[0]).toEqual({
        userId: 1,
        empid: 'E1',
        email: 'e1@example.test',
      });
      expect(result.at(-1)).toEqual({
        userId: count,
        empid: `E${count}`,
        email: `e${count}@example.test`,
      });
      expect(new Set(result.map((r) => r.userId)).size).toBe(count);
      expect(batchSizes).toHaveLength(Math.ceil(count / 100));
      expect(Math.max(...batchSizes)).toBeLessThanOrEqual(100);
      expect(peak).toBeLessThanOrEqual(4);
    },
  );

  it.each([
    { isActive: false },
    { deletedAt: new Date() },
    { empid: 'invalid-id' },
  ])('停用、刪除或員編不合法不查來源 %#', async (changed) => {
    const { service, manager, http } = fixture();
    manager.find.mockResolvedValue([
      { id: 1, empid: '001', isActive: true, ...changed },
    ]);
    await expect(service.checkDraft(10, 1, ['1'])).rejects.toMatchObject({
      status: 422,
      response: { details: { userIds: ['1'] } },
    });
    expect(http.post).not.toHaveBeenCalled();
  });
  it('非建立人／非草稿／無效帳號先拒絕，不查信箱來源', async () => {
    const { service, manager, http } = fixture();
    await expect(service.checkDraft(10, 2, ['1'])).rejects.toMatchObject({
      status: 404,
    });
    manager.findOne.mockResolvedValue({
      id: 10,
      createdByUserId: 1,
      status: 'active',
    });
    await expect(service.checkDraft(10, 1, ['1'])).rejects.toMatchObject({
      status: 409,
    });
    manager.findOne.mockResolvedValue({
      id: 10,
      createdByUserId: 1,
      status: 'draft',
    });
    await expect(service.checkDraft(10, 1, ['3'])).rejects.toMatchObject({
      status: 422,
      response: { details: { userIds: ['3'] } },
    });
    expect(http.post).not.toHaveBeenCalled();
  });
  it('缺漏及非法地址顯示 unavailable 而非來源失敗', async () => {
    const { service, http } = fixture();
    http.post.mockReturnValue(
      of({
        data: {
          success: true,
          data: [{ person_empid: '002', email: 'invalid' }],
        },
      }),
    );
    await expect(service.checkDraft(10, 1, ['1', '2'])).resolves.toEqual({
      items: [
        { userId: '1', status: 'unavailable', maskedEmail: null },
        { userId: '2', status: 'unavailable', maskedEmail: null },
      ],
    });
  });
  it('每批最多 100，最多 4 批併發；失敗後不再派送且等待已派請求收束', async () => {
    const { service, http } = fixture();
    const requests: Array<{
      ids: string[];
      finish: () => void;
      fail: () => void;
    }> = [];
    http.post.mockImplementation(
      (_url: string, body: { person_empids: string[] }) =>
        new Observable((subscriber) => {
          requests.push({
            ids: body.person_empids,
            finish: () => {
              subscriber.next({ data: { success: true, data: [] } });
              subscriber.complete();
            },
            fail: () => subscriber.error(new Error('合成來源失敗')),
          });
        }),
    );
    const identities = Array.from({ length: 501 }, (_, i) => ({
      userId: i + 1,
      empid: `E${i + 1}`,
    }));
    let settled = false;
    const pending = service.lookupEmails(identities);
    const rejected = expect(pending).rejects.toMatchObject({ status: 502 });
    void pending.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(requests).toHaveLength(4);
    expect(requests.map((r) => r.ids.length)).toEqual([100, 100, 100, 100]);
    requests[0].fail();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settled).toBe(false);
    requests.slice(1).forEach((r) => r.finish());
    await rejected;
    expect(requests).toHaveLength(4);
  });
  it('建立人取得去重且原順序的遮罩結果，同信箱仍保留各員工', async () => {
    const { service } = fixture();
    await expect(service.checkDraft(10, 1, ['2', '1', '2'])).resolves.toEqual({
      items: [
        { userId: '2', status: 'ready', maskedEmail: 's***@example.test' },
        { userId: '1', status: 'ready', maskedEmail: 's***@example.test' },
      ],
    });
  });
});
