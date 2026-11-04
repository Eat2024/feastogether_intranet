import { canonicalJson, canonicalSha256 } from './signing-evidence';

describe('簽署證據 canonical JSON 相容性', () => {
  it('維持原本 UTC、字典序、陣列順序及省略 undefined 的格式', () => {
    const value = {
      z: '中文',
      a: { d: 2, c: 1 },
      time: new Date(0),
      list: [2, 1],
      omitted: undefined,
    };
    expect(canonicalJson(value)).toBe(
      '{"a":{"c":1,"d":2},"list":[2,1],"time":"1970-01-01T00:00:00.000Z","z":"中文"}',
    );
    expect(canonicalSha256({ b: 2, a: 1 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
  });
});
