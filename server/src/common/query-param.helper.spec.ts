import { toStringArray } from './query-param.helper';

/**
 * 三種來源形狀（重複 key／逗號分隔／單值）與各種「空」的收斂。
 *
 * 這支的邊界值得測，是因為它同時服務兩種相反的期待：必填欄位靠 `[]` 觸發
 * `@ArrayNotEmpty` 的專屬訊息，選填維度靠 `[]` 自行轉 `undefined`。
 * 回錯形狀不會炸，只會讓錯誤訊息或篩選條件無聲跑掉。
 */
describe('toStringArray', () => {
  it('重複 query key（陣列）原樣保留順序', () => {
    expect(toStringArray(['A', 'B'])).toEqual(['A', 'B']);
  });

  it('逗號分隔字串拆開，並去空白與空字串', () => {
    expect(toStringArray('A, B ,,C')).toEqual(['A', 'B', 'C']);
  });

  it('單值包成一個元素', () => {
    expect(toStringArray(' M1 ')).toEqual(['M1']);
  });

  it('陣列元素本身含逗號時一併拆開（兩種寫法可混用）', () => {
    expect(toStringArray(['A,B', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['空字串', ''],
    ['全空白', '   '],
    ['空陣列', []],
    ['只有分隔符', ',,,'],
  ])('%s → 回空陣列（MUST NOT 回 undefined）', (_label, input) => {
    expect(toStringArray(input)).toEqual([]);
  });

  it('非字串以 String() 轉換而非丟棄（JSON body 的數字是合理輸入）', () => {
    expect(toStringArray([123, 'A'])).toEqual(['123', 'A']);
  });

  it('陣列中的 null / undefined 剔除，不得變成 "null" / "undefined"', () => {
    expect(toStringArray(['A', null, undefined, 'B'])).toEqual(['A', 'B']);
  });
});
