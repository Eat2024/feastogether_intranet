import { EsignStoppageService } from './esign-stoppage.service';

describe('EsignStoppageService', () => {
  const manager = {} as never;

  function setup(status = 'active') {
    const document = {
      id: 3,
      status,
      createdByUserId: 7,
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
    const access = { checkEsignCreator: jest.fn() };
    const validation = {
      assertActiveForStop: jest.fn((value: { status: string }) => {
        if (!['active', 'finalizing'].includes(value.status))
          throw new Error('只有簽署中的文件可以停止');
      }),
    };
    const audit = { append: jest.fn() };
    const service = new EsignStoppageService(
      mysql as never,
      documents as never,
      signerRepository as never,
      access as never,
      validation as never,
      audit as never,
    );
    return { service, document, signers, documents, access, audit };
  }

  it('creator 停止時必填理由、保留已簽 credential/evidence 並使 pending 邀請失效', async () => {
    const { service, document, signers, access, audit } = setup();
    expect(() => service.stopByCreator(3, 7, '   ')).toThrow(
      '停止原因必須為 1 至 500 字',
    );

    await expect(service.stopByCreator(3, 7, '資料有誤')).resolves.toBe(true);
    expect(access.checkEsignCreator).toHaveBeenCalled();
    expect(document).toMatchObject({
      status: 'stopped',
      stopReason: '資料有誤',
    });
    expect(signers[0].invitationTokenSha256).toBe('signed-digest');
    expect(signers[0].completionStatus).toBe('ready');
    expect(signers[1].invitationTokenSha256).toBeNull();
    expect(signers[1].invitationTokenCiphertext).toBeNull();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'document.stopped_by_creator' }),
      manager,
    );
  });

  it.each(['completed'])('%s 不可手動停止', async (status) => {
    const { service, documents } = setup(status);
    await expect(service.stopByCreator(3, 7, '停止')).rejects.toThrow(
      '只有簽署中的文件可以停止',
    );
    expect(documents.save).not.toHaveBeenCalled();
  });

  it('deadline 只在 now >= end 且仍有 pending signer 時停止，重複 job 為 no-op', async () => {
    const { service, document, audit } = setup();
    await expect(
      service.stopByDeadline(3, new Date('2026-10-13T11:59:59.999Z')),
    ).resolves.toBe(false);
    expect(document.status).toBe('active');

    await expect(
      service.stopByDeadline(3, new Date('2026-10-13T12:00:00.000Z')),
    ).resolves.toBe(true);
    expect(document.stopReason).toBe('簽署期限已到');
    expect(audit.append).toHaveBeenCalledTimes(1);

    await expect(
      service.stopByDeadline(3, new Date('2026-10-13T12:01:00.000Z')),
    ).resolves.toBe(false);
    expect(audit.append).toHaveBeenCalledTimes(1);
  });
});
