import { EsignStoppageService } from './esign-stoppage.service';

describe('EsignStoppageService', () => {
  const manager = {} as never;

  function setup(status = 'active') {
    const document = {
      id: 3,
      status,
      createdByUserId: 7,
      createdByDepartmentCode: '00A',
      createdByDepartmentName: '建立時部門',
      signEndAt: new Date('2026-10-13T12:00:00.000Z'),
    };
    const signers = [
      {
        status: 'signed',
        invitationTokenSha256: 'signed-digest',
        invitationTokenCiphertext: undefined,
        invitationExpiresAt: new Date('2026-10-13T12:00:00.000Z'),
        completionStatus: 'ready',
      },
      {
        status: 'pending',
        invitationTokenSha256: 'pending-digest',
        invitationTokenCiphertext: 'ciphertext',
        invitationExpiresAt: new Date('2026-10-13T12:00:00.000Z'),
      },
    ];
    const mysql = {
      getManager: () => manager,
      transaction: jest.fn((run: (value: never) => Promise<unknown>) =>
        run(manager),
      ),
    };
    const documents = {
      findByIdForUpdate: jest.fn(async () => document),
      save: jest.fn(async (value: object) => value),
    };
    const signerRepository = {
      findByDocumentForUpdate: jest.fn(async () => signers),
      saveMany: jest.fn(async (value: object[]) => value),
    };
    const access = {
      lockManagedDocument: jest.fn(async () => document),
      assertManagerNotInitiating: jest.fn().mockResolvedValue(undefined),
      assertNotInitiating: jest.fn().mockResolvedValue(undefined),
    };
    const validation = {
      assertActiveForStop: jest.fn((value: { status: string }) => {
        if (!['active', 'expired', 'finalizing'].includes(value.status))
          throw new Error('只有簽署中的文件可以停止');
      }),
    };
    const service = new EsignStoppageService(
      mysql as never,
      documents as never,
      signerRepository as never,
      access as never,
      validation as never,
    );
    return { service, document, signers, documents, access };
  }

  it.each(['active', 'expired'])(
    '%s creator 停止時必填理由、保留已簽 credential/evidence 並使 pending 邀請失效',
    async (status) => {
      const { service, document, signers, access } = setup(status);
      expect(() =>
        service.stopByActor(3, { kind: 'employee', userId: 7 }, '   '),
      ).toThrow('停止原因必須為 1 至 500 字');

      await expect(
        service.stopByActor(3, { kind: 'employee', userId: 7 }, '資料有誤'),
      ).resolves.toBe(true);
      expect(access.lockManagedDocument).toHaveBeenCalled();
      expect(document).toMatchObject({
        createdByUserId: 7,
        createdByDepartmentCode: '00A',
        createdByDepartmentName: '建立時部門',
        status: 'stopped',
        stopReason: '資料有誤',
      });
      expect(signers[0].invitationTokenSha256).toBe('signed-digest');
      expect(signers[0].completionStatus).toBe('ready');
      expect(signers[1].invitationTokenSha256).toBeNull();
      expect(signers[1].invitationTokenCiphertext).toBeNull();
    },
  );

  it.each(['completed'])('%s 不可手動停止', async (status) => {
    const { service, documents } = setup(status);
    await expect(
      service.stopByActor(3, { kind: 'employee', userId: 7 }, '停止'),
    ).rejects.toThrow('只有簽署中的文件可以停止');
    expect(documents.save).not.toHaveBeenCalled();
  });
});
