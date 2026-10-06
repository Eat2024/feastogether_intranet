import { maskSensitive } from './log-masker';

interface NestedSecrets {
  username: string;
  password: string;
  nested: {
    token: string;
    authorization: string;
    keep: number;
  };
}

interface MutableSecrets {
  password: string;
  nested: {
    token: string;
  };
}

type MaskedArrayItem = { password?: string; ok?: number };

interface NullableSecrets {
  password: null;
  token: undefined;
}

interface ContactFields {
  email: string;
  phone: string;
}

describe('log-masker', () => {
  it('遮罩 top-level 與巢狀的 password / token / authorization', () => {
    const input: NestedSecrets = {
      username: 'alice',
      password: 'secret',
      nested: { token: 'abc', authorization: 'Bearer x', keep: 1 },
    };
    const out = maskSensitive(input) as NestedSecrets;
    expect(out.username).toBe('alice');
    expect(out.password).toBe('***');
    expect(out.nested.token).toBe('***');
    expect(out.nested.authorization).toBe('***');
    expect(out.nested.keep).toBe(1);
  });

  it('遮罩驗證碼欄位', () => {
    expect(
      maskSensitive({
        verificationCode: 'secret-code',
        verification_code: 'secret-code',
      }),
    ).toEqual({
      verificationCode: '***',
      verification_code: '***',
    });
  });

  it('回傳新物件，不 mutate 原值（憲章 I）', () => {
    const input: MutableSecrets = {
      password: 'secret',
      nested: { token: 't' },
    };
    const out = maskSensitive(input) as MutableSecrets;
    expect(input.password).toBe('secret');
    expect(input.nested.token).toBe('t');
    expect(out).not.toBe(input);
    expect(out.nested).not.toBe(input.nested);
  });

  it('陣列逐項遮罩', () => {
    const out = maskSensitive([
      { password: 'a' },
      { ok: 1 },
    ]) as MaskedArrayItem[];
    expect(out[0].password).toBe('***');
    expect(out[1].ok).toBe(1);
  });

  it('null / undefined 值保留原樣、非物件原樣回傳', () => {
    expect(maskSensitive('plain')).toBe('plain');
    const out = maskSensitive({
      password: null,
      token: undefined,
    }) as NullableSecrets;
    expect(out.password).toBeNull();
    expect(out.token).toBeUndefined();
  });

  it('無 phone / email 規則（不誤遮）', () => {
    const out = maskSensitive({
      email: 'a@b.c',
      phone: '0912',
    }) as ContactFields;
    expect(out.email).toBe('a@b.c');
    expect(out.phone).toBe('0912');
  });
});
