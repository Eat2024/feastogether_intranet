import { tz } from '@date-fns/tz';
import { addHours, addWeeks, startOfWeek, subHours } from 'date-fns';
import { TAIPEI_TIME_ZONE_ID } from '#app/common/date-time.helper';

const TAIPEI = tz(TAIPEI_TIME_ZONE_ID);

/** 入口輪換週期起點：每週一台北 04:00，與 worker cron `0 4 * * 1`（Asia/Taipei）一致。 */
const PERIOD_START_HOUR = 4;

/**
 * 不晚於 now 的最近一個週期起點（UTC 保存）。初始化以它作為已處理週期，輪換以它判斷是否到期。
 * 台北沒有日光節約時間：先退 4 小時取台北週一 00:00，再加回 4 小時，週一 04:00 前就落在上一週期。
 */
export function latestDueRotationPeriod(now: Date): Date {
  const weekStart = startOfWeek(subHours(now, PERIOD_START_HOUR), {
    weekStartsOn: 1,
    in: TAIPEI,
  });
  return new Date(addHours(weekStart, PERIOD_START_HOUR));
}

/** 已處理週期的下一個週期起點，即目前入口預定輪換的時間。 */
export function nextRotationPeriod(periodStart: Date): Date {
  return new Date(addWeeks(periodStart, 1, { in: TAIPEI }));
}
