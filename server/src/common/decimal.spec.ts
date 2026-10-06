import { Decimal, toFixedStr } from './decimal';

describe('common/decimal', () => {
  describe('toFixedStr', () => {
    it('null/undefined/空字串 → 0 補到指定位數', () => {
      expect(toFixedStr(null, 3)).toBe('0.000');
      expect(toFixedStr(undefined, 3)).toBe('0.000');
      expect(toFixedStr('', 3)).toBe('0.000');
    });

    it('補齊 scale（DB 可能回不同位數）', () => {
      expect(toFixedStr('70', 3)).toBe('70.000');
      expect(toFixedStr('70.0', 3)).toBe('70.000');
      expect(toFixedStr('70.000', 3)).toBe('70.000');
    });

    it('正確進位——避開 JS float 的 (1.005).toFixed(2) === "1.00" 錯誤', () => {
      // 原生：Number(1.005).toFixed(2) → "1.00"（錯）；decimal.js ROUND_HALF_UP → "1.01"
      expect(toFixedStr('1.005', 2)).toBe('1.01');
      expect(Number(1.005).toFixed(2)).toBe('1.00'); // 對照：證明原生確實錯
    });

    it('大數不失精度——避開 Number 的 15~16 位有效數字上限', () => {
      // decimal(15,3) 上限量級
      expect(toFixedStr('999999999999.999', 3)).toBe('999999999999.999');
    });

    it('多餘位數依 ROUND_HALF_UP 收斂', () => {
      expect(toFixedStr('12.3455', 3)).toBe('12.346');
      expect(toFixedStr('12.3454', 3)).toBe('12.345');
    });
  });

  describe('Decimal（已設定進位規則的隔離建構子，供量運算）', () => {
    it('加減乘為 exact——避開 0.1 + 0.2 !== 0.3', () => {
      expect(new Decimal('0.1').plus('0.2').toString()).toBe('0.3');
      expect(new Decimal('100').minus('30.5').toFixed(3)).toBe('69.500');
    });

    it('cmp 可精確比較（供允差判定）', () => {
      expect(new Decimal('70.001').cmp('70')).toBe(1);
      expect(new Decimal('70').cmp('70.000')).toBe(0);
    });
  });
});
