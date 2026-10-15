'use client';

import { useEffect } from 'react';
import { envelopeData } from '@/lib/api/envelope';
import { redirectExpiredSession } from './navigation';

/** 到期及返回分頁時向後端確認；其他分頁已重新登入時沿用新 session。 */
export default function SessionExpiry({ expiresAt }: { expiresAt: string }) {
  useEffect(() => {
    let active = true;
    let checking = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule(expiry: string) {
      clearTimeout(timer);
      const remaining = Date.parse(expiry) - Date.now();
      if (Number.isFinite(remaining)) timer = setTimeout(() => void check(), Math.min(2_147_483_647, Math.max(1000, remaining + 1000)));
    }

    async function check() {
      if (!active || checking) return;
      checking = true;
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!active || redirectExpiredSession(response) || !response.ok) return;
        const data = envelopeData(await response.json());
        if (active && data && typeof data === 'object' && 'expiresAt' in data && typeof data.expiresAt === 'string') schedule(data.expiresAt);
      } catch {
        // 連線失敗不等於登入失效；下次返回分頁或業務請求時再驗證。
      } finally {
        checking = false;
      }
    }

    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    schedule(expiresAt);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [expiresAt]);
  return null;
}
