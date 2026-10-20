// 時間長度換算成毫秒（快取時間等設定用）
const SECOND_IN_MS = 1000;

export const seconds = (value: number) => value * SECOND_IN_MS;
export const minutes = (value: number) => seconds(value * 60);
export const hours = (value: number) => minutes(value * 60);
export const days = (value: number) => hours(value * 24);
