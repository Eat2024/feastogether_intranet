import { Suspense } from 'react';
import type { Metadata } from 'next';
import LoginForm from '@/features/auth/LoginForm';

export const metadata: Metadata = { title: '登入｜電子簽署' };

export default function LoginPage() {
  // 登入頁不因殘留 cookie 導回首頁，避免過期 session 的重導循環。
  return <Suspense><LoginForm /></Suspense>;
}
