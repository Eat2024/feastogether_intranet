import { EsignDocumentField } from '../entities/esign-document-field.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignFileObject } from '../entities/esign-file-object.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { EsignDocumentValidationService } from './esign-document-validation.service';

describe('EsignDocumentValidationService', () => {
  const service = new EsignDocumentValidationService();
  const document = (fields: Partial<EsignDocument> = {}) =>
    Object.assign(new EsignDocument(), {
      id: 1,
      status: 'active',
      signStartAt: new Date('2026-10-13T00:00:00.000Z'),
      signEndAt: new Date('2026-10-14T00:00:00.000Z'),
      ...fields,
    });

  it('簽署區間固定為 start <= now < end', () => {
    const active = document();
    expect(() =>
      service.assertActiveSigningWindow(
        active,
        new Date('2026-10-13T00:00:00.000Z'),
      ),
    ).not.toThrow();
    expect(() =>
      service.assertActiveSigningWindow(
        active,
        new Date('2026-10-14T00:00:00.000Z'),
      ),
    ).toThrow('不在可簽署期間');
  });

  it('draft、stop transition 與 pending signer 均重驗目前狀態', () => {
    expect(() =>
      service.checkStillDraft(document({ status: 'draft' })),
    ).not.toThrow();
    expect(() => service.checkStillDraft(document())).toThrow('已發起');
    expect(() => service.assertActiveForStop(document())).not.toThrow();
    expect(() =>
      service.assertActiveForStop(document({ status: 'completed' })),
    ).toThrow('只有簽署中、已到期或產製中的文件');

    const signer = Object.assign(new EsignSigner(), {
      id: 2,
      documentId: 1,
      status: 'pending',
    });
    expect(() => service.assertPendingSigner(signer, 1)).not.toThrow();
    signer.status = 'signed';
    expect(() => service.assertPendingSigner(signer, 1)).toThrow(
      '簽署任務目前無法操作',
    );
  });

  it('共用欄位必須屬於簽署人的文件', () => {
    const signer = Object.assign(new EsignSigner(), { id: 2, documentId: 1 });
    const field = Object.assign(new EsignDocumentField(), {
      documentId: 1,
    });
    expect(() =>
      service.assertFieldsBelongToDocument([field], signer.documentId),
    ).not.toThrow();
    field.documentId = 3;
    expect(() =>
      service.assertFieldsBelongToDocument([field], signer.documentId),
    ).toThrow('不相符');
  });

  it('source 與 payload hash 每次以 persisted/recalculated 值比對', () => {
    const active = document({
      signingPayloadJson: { a: 1 },
      signingPayloadSha256: 'payload-hash',
    });
    const source = Object.assign(new EsignFileObject(), {
      documentId: 1,
      filePurpose: 'source_pdf',
      archiveStatus: 'active',
      sha256: 'source-hash',
    });
    expect(() =>
      service.assertSourceIntegrity(active, source, 'source-hash'),
    ).not.toThrow();
    expect(() =>
      service.assertSourceIntegrity(active, source, 'tampered'),
    ).toThrow('完整性驗證失敗');
    expect(() =>
      service.assertPayloadIntegrity(active, 'payload-hash'),
    ).not.toThrow();
    expect(() => service.assertPayloadIntegrity(active, 'tampered')).toThrow(
      '完整性驗證失敗',
    );
  });

  it('原檔或共用位置被改動，即使各自仍有有效 hash 也不可偏離發起快照', () => {
    const field = Object.assign(new EsignDocumentField(), {
      id: 10,
      documentId: 1,
      fieldType: 'signature',
      pageNumber: 1,
      xPercent: '10.0000',
      yPercent: '20.0000',
      widthPercent: '30.0000',
      heightPercent: '10.0000',
      sortOrder: 0,
    });
    const active = document({
      signingPayloadJson: {
        document: { id: '1', sourceFileSha256: 'original' },
        fields: [
          {
            id: '10',
            type: 'signature',
            page: 1,
            xPercent: 10,
            yPercent: 20,
            widthPercent: 30,
            heightPercent: 10,
            sortOrder: 0,
          },
        ],
      },
    });
    expect(() =>
      service.assertSigningSnapshot(active, 'original', [field]),
    ).not.toThrow();
    expect(() =>
      service.assertSigningSnapshot(active, 'replacement', [field]),
    ).toThrow('完整性');
    expect(() => service.assertSigningSnapshot(active, 'original', [])).toThrow(
      '完整性',
    );
    field.xPercent = '11.0000';
    expect(() =>
      service.assertSigningSnapshot(active, 'original', [field]),
    ).toThrow('完整性');
  });
});
