import { latestDueRotationPeriod, nextRotationPeriod } from './rotation-period';

const taipei = (local: string) => new Date(`${local}+08:00`);

describe('rotation-period', () => {
  it.each([
    ['週一 04:00 整即為新週期', '2026-11-02T04:00:00.000', '2026-11-02T04:00'],
    [
      '週一 03:59:59.999 仍屬上一週期',
      '2026-11-02T03:59:59.999',
      '2026-10-26T04:00',
    ],
    [
      '週日深夜屬本週一起算的週期',
      '2026-11-08T23:59:59.999',
      '2026-11-02T04:00',
    ],
    [
      'UTC 已是週一、台北週一上午',
      '2026-11-02T09:00:00.000',
      '2026-11-02T04:00',
    ],
    [
      '跨年：元旦屬前一年最後一個週一',
      '2026-01-01T12:00:00.000',
      '2025-12-29T04:00',
    ],
    [
      '跨年：週一 04:00 前仍屬去年週期',
      '2027-01-04T03:59:59.999',
      '2026-12-28T04:00',
    ],
    [
      '跨年：週一 04:00 進入新年週期',
      '2027-01-04T04:00:00.000',
      '2027-01-04T04:00',
    ],
  ])('%s', (_, now, expected) => {
    expect(latestDueRotationPeriod(taipei(now))).toEqual(taipei(expected));
  });

  it('下一週期為七天後的週一 04:00，跨年亦同', () => {
    expect(nextRotationPeriod(taipei('2026-11-02T04:00'))).toEqual(
      taipei('2026-11-09T04:00'),
    );
    expect(nextRotationPeriod(taipei('2026-12-28T04:00'))).toEqual(
      taipei('2027-01-04T04:00'),
    );
  });
});
