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
    ).toThrow('只有簽署中的文件');

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

  it('欄位必須同時屬於相同 document 與 signer', () => {
    const signer = Object.assign(new EsignSigner(), { id: 2, documentId: 1 });
    const field = Object.assign(new EsignDocumentField(), {
      documentId: 1,
      signerId: 2,
    });
    expect(() =>
      service.assertFieldsBelongToSigner([field], signer),
    ).not.toThrow();
    field.signerId = 3;
    expect(() => service.assertFieldsBelongToSigner([field], signer)).toThrow(
      '不相符',
    );
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
});
