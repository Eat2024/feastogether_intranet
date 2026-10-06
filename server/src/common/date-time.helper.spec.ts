import {
  formatInTaipei,
  toDateStr,
  todayInTaipei,
  toUtcDateTime,
} from './date-time.helper';

describe('date-time.helper', () => {
  describe('toUtcDateTime', () => {
    it('將帶 UTC+8 offset 的時間轉為 DB 使用的 UTC datetime', () => {
      expect(toUtcDateTime('2026-07-29T20:30:45.123+08:00')).toBe(
        '2026-07-29 12:30:45.123',
      );
    });

    it('保留 UTC 時間並移除時區標記', () => {
      expect(toUtcDateTime(new Date('2026-07-29T12:30:45.123Z'))).toBe(
        '2026-07-29 12:30:45.123',
      );
    });
  });

  describe('formatInTaipei（日曆日推導）', () => {
    /**
     * 關鍵案例：UTC 與台北落在**不同日曆日**的時段。
     * 用 `new Date().getMonth()/getDate()` 在 UTC container 上會取到前一天——
     * 台北早上 8 點前產生的日期字串就會變成昨天。
     * 本測試明確傳入時區，故在任何機器時區下結果都相同。
     */
    it('台灣 07:00（UTC 前一日 23:00）→ 取台北的日曆日', () => {
      expect(formatInTaipei('2026-07-29T23:00:00Z', 'MMdd')).toBe('0730');
      expect(formatInTaipei('2026-07-29T23:00:00Z', 'yyyy-MM-dd')).toBe(
        '2026-07-30',
      );
    });

    it('台灣 08:00（UTC 同日 00:00）→ 兩者同日，仍取台北', () => {
      expect(formatInTaipei('2026-07-30T00:00:00Z', 'MMdd')).toBe('0730');
    });

    it('台灣午夜 00:00（UTC 前一日 16:00）→ 已是新的一天', () => {
      expect(formatInTaipei('2026-07-29T16:00:00Z', 'MMdd')).toBe('0730');
    });

    it('台灣 23:59（UTC 同日 15:59）→ 仍為當日', () => {
      expect(formatInTaipei('2026-07-30T15:59:00Z', 'MMdd')).toBe('0730');
    });
  });

  describe('todayInTaipei（全專案取「今天」的唯一入口）', () => {
    // UTC 07/29 23:00 ＝ 台北 07/30 07:00（台北早上）。
    // 用本地 getter 在 UTC container 上會取到 07/29——以日期命名或計算期限的資料都會差一天。
    const UTC_EVENING = new Date('2026-07-29T23:00:00Z');

    it('取台北的日曆日，不是 server 本地時區的', () => {
      jest.useFakeTimers().setSystemTime(UTC_EVENING);
      try {
        expect(todayInTaipei()).toBe('2026-07-30');
      } finally {
        jest.useRealTimers();
      }
    });

    it('預設 yyyy-MM-dd，可指定其他 pattern', () => {
      jest.useFakeTimers().setSystemTime(UTC_EVENING);
      try {
        expect(todayInTaipei('yyyyMMdd')).toBe('20260730');
        expect(todayInTaipei('MMdd')).toBe('0730');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('toDateStr（date 欄位的格式收斂）', () => {
    it('null/undefined → null', () => {
      expect(toDateStr(null)).toBeNull();
      expect(toDateStr(undefined)).toBeNull();
    });

    it('string → 取前 10 碼（YYYY-MM-DD）', () => {
      expect(toDateStr('2026-07-24')).toBe('2026-07-24');
      expect(toDateStr('2026-07-24T00:00:00.000Z')).toBe('2026-07-24');
    });

    it('Date → UTC getter（driver timezone +00:00：UTC 午夜不因本地時區差一天）', () => {
      // UTC 午夜 2026-07-25：以本地 getter 於 UTC 以西時區會回 07-24（bug 來源）
      expect(toDateStr(new Date('2026-07-25T00:00:00.000Z'))).toBe(
        '2026-07-25',
      );
    });

    it('⚠️ 是格式收斂而非時區轉換——同一時刻與 todayInTaipei 可以不同日', () => {
      // 台北 07/30 07:00 的那一刻，UTC 還是 07/29。
      const instant = new Date('2026-07-29T23:00:00Z');
      expect(toDateStr(instant)).toBe('2026-07-29');
      expect(formatInTaipei(instant, 'yyyy-MM-dd')).toBe('2026-07-30');
    });
  });
});
