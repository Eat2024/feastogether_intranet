import { notificationStatus } from './notification-status';
describe('通知批次對外狀態', () => {
  it('部分失敗不能宣稱全部完成；未知投遞獨立呈現', () => {
    expect(notificationStatus({ delivered: 2, failed: 1 })).toBe(
      'partial_failed',
    );
    expect(notificationStatus({ failed: 2 })).toBe('failed');
    expect(notificationStatus({ delivered: 2, unknown: 1 })).toBe('unknown');
    expect(notificationStatus({ pending: 2 })).toBe('queued');
    expect(notificationStatus({ pending: 2, processing: 1 })).toBe(
      'processing',
    );
    expect(notificationStatus({ delivered: 2, skipped: 1 })).toBe('completed');
  });
});
