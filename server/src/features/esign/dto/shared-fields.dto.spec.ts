import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitiateDocumentDto } from './initiation.dto';
import { ReplaceSignersDto } from './signer.dto';
import { ReplaceFieldsDto } from './field.dto';

const placement = {
  type: 'signature',
  page: 1,
  xPercent: 10,
  yPercent: 20,
  widthPercent: 30,
  heightPercent: 15,
  sortOrder: 0,
};
const validateInput = (input: object) =>
  validate(input, {
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });

describe('共用欄位與完整簽署名單契約', () => {
  it('6,001 人可以保存與發起，三個共用欄位不按人數複製', async () => {
    const signers = Array.from({ length: 6001 }, (_, index) => ({
      type: 'user',
      userId: String(index + 1),
    }));
    expect(
      await validateInput(plainToInstance(ReplaceSignersDto, { signers })),
    ).toEqual([]);
    expect(
      await validateInput(
        plainToInstance(InitiateDocumentDto, {
          signers,
          fields: [placement, placement, { ...placement, type: 'date' }],
          signStartAt: '2026-10-16T00:00:00.000Z',
          signEndAt: '2026-12-31T00:00:00.000Z',
          watermark: false,
          allowReject: false,
        }),
      ),
    ).toEqual([]);
  });

  it.each(['signerIndex', 'signerPublicId'])(
    '拒絕已移除的欄位指派 %s',
    async (key) => {
      expect(
        await validateInput(
          plainToInstance(ReplaceFieldsDto, {
            fields: [
              {
                ...placement,
                [key]:
                  key === 'signerIndex'
                    ? 0
                    : 'c854d925-1d70-49dc-9c81-abf18409ae42',
              },
            ],
          }),
        ),
      ).not.toEqual([]);
    },
  );

  it('仍拒絕空名單及第 201 個欄位', async () => {
    expect(
      await validateInput(plainToInstance(ReplaceSignersDto, { signers: [] })),
    ).not.toEqual([]);
    expect(
      await validateInput(
        plainToInstance(ReplaceFieldsDto, {
          fields: Array.from({ length: 201 }, () => placement),
        }),
      ),
    ).not.toEqual([]);
  });
});
