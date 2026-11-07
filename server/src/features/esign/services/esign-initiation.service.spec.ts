import { User } from '#app/features/users/entities/user.entity';
import {
  type InitiateDocumentInput,
  EsignInitiationService,
} from './esign-initiation.service';

describe('EsignInitiationService', () => {
  const manager = {} as never;
  const start = new Date('2026-10-13T00:00:00.000Z');
  const end = new Date('2026-10-20T00:00:00.000Z');

  function setup(options?: { fields?: object[]; signers?: object[] }) {
    const document = {
      id: 3,
      docNumber: '550e8400-e29b-41d4-a716-446655440000',
      title: '採購合約',
      status: 'draft',
      createdByUserId: 7,
      createdByDepartmentCode: '00A',
      createdByDepartmentName: '建立時部門',
    };
    const signers = options?.signers ?? [
      {
        id: 11,
        publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
        documentId: 3,
        signerType: 'email',
        email: 'candidate@example.test',
        nameSnapshot: '候選人',
        status: 'pending',
        sortOrder: 0,
      },
    ];
    const fields = options?.fields ?? [
      {
        id: 21,
        documentId: 3,
        fieldType: 'signature',
        pageNumber: 1,
        xPercent: '10.000',
        yPercent: '20.000',
        widthPercent: '30.000',
        heightPercent: '15.000',
        sortOrder: 0,
      },
    ];
    const source = {
      id: 31,
      documentId: 3,
      filePurpose: 'source_pdf',
      archiveStatus: 'active',
      objectKey: 'documents/x/source/y.pdf',
      mimeType: 'application/pdf',
      fileSize: 3,
      sha256: 'a'.repeat(64),
    };
    const mysql = {
      getManager: jest.fn(() => manager),
      transaction: jest.fn((run: (value: never) => Promise<unknown>) =>
        run(manager),
      ),
    };
    const documents = {
      findById: jest.fn(async () => document),
      save: jest.fn(async (value: object) => value),
    };
    const signerRepository = {
      findByDocumentForUpdate: jest.fn(async () => signers),
      saveMany: jest.fn(),
      deleteDraftSigners: jest.fn(),
      insertMany: jest.fn(async (value: object[]) => value),
    };
    const notifications = {
      createBatch: jest.fn((value: object) => value),
      saveBatch: jest.fn(async (value: object) => ({ id: 41, ...value })),
      createLog: jest.fn((value: object) => value),
      insertLogs: jest.fn(async (values: object[]) =>
        values.map((value, index) => ({ id: 51 + index, ...value })),
      ),
    };
    const access = {
      checkAndLockDraftDoc: jest.fn(async () => document),
      checkEsignDraftCreator: jest.fn(),
    };
    const pdf = {
      validatePersistedPdf: jest.fn(async () => ({
        mimeType: 'application/pdf',
        fileSize: 3,
        pageCount: 1,
        sha256: 'a'.repeat(64),
      })),
    };
    const consent = {
      getActive: jest.fn(() => ({
        version: 'esign-consent-v1',
        text: '告知',
        sha256: 'b'.repeat(64),
      })),
    };
    const tokens = {
      createInvitationToken: jest.fn(() => ({
        token: 'sensitive',
        digest: 'c'.repeat(64),
        ciphertext: 'v1.encrypted',
      })),
    };
    const jobs = { enqueueInvitations: jest.fn() };
    const signerService = {
      prepareSigners: jest.fn(() => Promise.resolve(signers)),
    };
    const fieldService = {
      buildFields: jest.fn(async () => ({
        fields,
        source,
        sourceMetadata: await pdf.validatePersistedPdf(),
      })),
    };
    const employeeEmails = {
      resolveForInitiation: jest.fn(() =>
        Promise.resolve(
          new Map([
            [
              8,
              Object.assign(new User(), {
                id: 8,
                empid: 'E008',
                email: 'employee@example.test',
                name: '員工',
                isActive: true,
              }),
            ],
          ]),
        ),
      ),
    };
    const service = new EsignInitiationService(
      mysql as never,
      documents as never,
      signerRepository as never,
      notifications as never,
      access as never,
      consent as never,
      tokens as never,
      jobs as never,
      signerService as never,
      fieldService as never,
      employeeEmails as never,
    );
    return {
      service,
      mysql,
      documents,
      signerRepository,
      employeeEmails,
      signerService,
      fieldService,
      document,
      access,
      notifications,
      jobs,
      tokens,
    };
  }

  it('呼叫端交易可完成發起核心但不自行提交或派送通知', async () => {
    const { service, mysql, documents, jobs } = setup();
    const input: InitiateDocumentInput = {
      documentId: 3,
      creatorUserId: 7,
      signers: [
        { type: 'email', name: '候選人', email: 'candidate@example.test' },
      ],
      fields: [
        {
          type: 'signature',
          page: 1,
          xPercent: 10,
          yPercent: 20,
          widthPercent: 30,
          heightPercent: 15,
          sortOrder: 0,
        },
      ],
      signStartAt: start,
      signEndAt: end,
      watermark: false,
      allowReject: false,
    };
    const result = await service.initiateInTransaction(input, manager);
    expect(result.document.status).toBe('active');
    expect(result.notificationJobs).toEqual([[51]]);
    expect(mysql.transaction).not.toHaveBeenCalled();
    expect(mysql.getManager).not.toHaveBeenCalled();
    expect(documents.save).toHaveBeenCalledWith(result.document, manager);
    expect(jobs.enqueueInvitations).not.toHaveBeenCalled();
  });

  it('鎖定草稿後固定 canonical payload 並只建立一次外部邀請 outbox', async () => {
    const {
      service,
      signerRepository,
      document,
      access,
      notifications,
      jobs,

      signerService,
      fieldService,
      employeeEmails,
    } = setup();
    await service.initiate({
      documentId: 3,
      creatorUserId: 7,
      signers: [
        { type: 'email', name: '候選人', email: 'candidate@example.test' },
      ],
      fields: [
        {
          type: 'signature',
          page: 1,
          xPercent: 10,
          yPercent: 20,
          widthPercent: 30,
          heightPercent: 15,
          sortOrder: 0,
        },
      ],
      signStartAt: start,
      signEndAt: end,
      watermark: true,
      allowReject: true,
    });

    expect(employeeEmails.resolveForInitiation).toHaveBeenCalledWith(
      [],
      7,
      manager,
    );
    expect(
      employeeEmails.resolveForInitiation.mock.invocationCallOrder[0],
    ).toBeLessThan(access.checkAndLockDraftDoc.mock.invocationCallOrder[0]);
    expect(signerService.prepareSigners).toHaveBeenCalledWith(
      document,
      { kind: 'employee', userId: 7 },
      expect.any(Array),
      manager,
      expect.any(Map),
    );
    expect(fieldService.buildFields).toHaveBeenCalledWith(
      document,
      { kind: 'employee', userId: 7 },
      expect.arrayContaining([
        expect.objectContaining({
          type: 'signature',
        }),
      ]),
      manager,
    );
    expect(access.checkAndLockDraftDoc).toHaveBeenCalledWith(
      3,
      7,
      manager,
      undefined,
    );
    expect(document).toMatchObject({
      createdByUserId: 7,
      createdByDepartmentCode: '00A',
      createdByDepartmentName: '建立時部門',
    });
    expect(document.status).toBe('active');
    expect(document).toMatchObject({
      watermarkEnabled: true,
      allowReject: true,
      signingPayloadJson: {
        options: { parallelSigning: true, allowReject: true, watermark: true },
      },
    });
    expect(document.signingPayloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(document.signingPayloadJson)).not.toContain(
      'sensitive',
    );
    expect(notifications.saveBatch).toHaveBeenCalledTimes(1);
    expect(notifications.insertLogs).toHaveBeenCalledTimes(1);
    expect(jobs.enqueueInvitations).toHaveBeenCalledWith([51]);
    expect(signerRepository.insertMany).toHaveBeenCalledTimes(1);
    expect(signerRepository.saveMany).not.toHaveBeenCalled();
    expect(signerRepository.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          invitationTokenSha256: 'c'.repeat(64),
          invitationTokenCiphertext: 'v1.encrypted',
          invitationExpiresAt: end,
        }),
      ],
      manager,
    );
  });

  it('共用欄位缺少 signature 欄位時維持草稿並拒絕', async () => {
    const { service, document, tokens } = setup({
      fields: [
        {
          id: 21,
          documentId: 3,
          signerId: 11,
          fieldType: 'date',
          pageNumber: 1,
        },
      ],
    });
    await expect(
      service.initiate({
        documentId: 3,
        creatorUserId: 7,
        signers: [
          { type: 'email', name: '候選人', email: 'candidate@example.test' },
        ],
        fields: [
          {
            type: 'signature',
            page: 1,
            xPercent: 10,
            yPercent: 20,
            widthPercent: 30,
            heightPercent: 15,
            sortOrder: 0,
          },
        ],
        signStartAt: start,
        signEndAt: end,
        watermark: false,
        allowReject: false,
      }),
    ).rejects.toThrow('至少需要一個共用簽名欄位');
    expect(document.status).toBe('draft');
    expect(tokens.createInvitationToken).not.toHaveBeenCalled();
  });

  it('拒絕相反或相同的簽署期間', async () => {
    const { service } = setup();
    await expect(
      service.initiate({
        documentId: 3,
        creatorUserId: 7,
        signers: [
          { type: 'email', name: '候選人', email: 'candidate@example.test' },
        ],
        fields: [
          {
            type: 'signature',
            page: 1,
            xPercent: 10,
            yPercent: 20,
            widthPercent: 30,
            heightPercent: 15,
            sortOrder: 0,
          },
        ],
        signStartAt: end,
        signEndAt: start,
        watermark: false,
        allowReject: false,
      }),
    ).rejects.toThrow('簽署開始時間必須早於截止時間');
  });

  it('純內部簽署人建立 invitation batch，但不產個人 token 而只排批次', async () => {
    const { service, notifications, jobs, tokens } = setup({
      signers: [
        {
          id: 11,
          publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
          documentId: 3,
          signerType: 'user',
          userId: 8,
          empidSnapshot: 'E008',
          nameSnapshot: '員工',
          status: 'pending',
          sortOrder: 0,
        },
      ],
    });
    await service.initiate({
      documentId: 3,
      creatorUserId: 7,
      signers: [{ type: 'user', userId: '8' }],
      fields: [
        {
          type: 'signature',
          page: 1,
          xPercent: 10,
          yPercent: 20,
          widthPercent: 30,
          heightPercent: 15,
          sortOrder: 0,
        },
      ],
      signStartAt: start,
      signEndAt: end,
      watermark: false,
      allowReject: false,
    });
    expect(notifications.saveBatch).toHaveBeenCalledTimes(1);
    expect(jobs.enqueueInvitations).toHaveBeenCalledWith([], [41]);
    expect(tokens.createInvitationToken).not.toHaveBeenCalled();
    expect(notifications.insertLogs.mock.calls[0][0]).toEqual([
      expect.objectContaining({ invitationGenerationSha256: null }),
    ]);
  });
});
