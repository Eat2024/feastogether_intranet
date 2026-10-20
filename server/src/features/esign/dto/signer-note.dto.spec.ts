import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignerNoteDto } from './signer-note.dto';

describe('管理備註輸入邊界', () => {
  it('trim 後接受 30 個 Unicode code points 與清空，不接受非字串或超長', async () => {
    for (const note of ['  ' + '😀'.repeat(30) + '  ', '   ']) {
      const dto = plainToInstance(SignerNoteDto, { note });
      expect(await validate(dto)).toEqual([]);
      expect(dto.note).toBe(note.trim());
    }
    for (const note of [undefined, null, 123, {}, '😀'.repeat(31)]) {
      expect(
        await validate(plainToInstance(SignerNoteDto, { note })),
      ).not.toEqual([]);
    }
  });
});
