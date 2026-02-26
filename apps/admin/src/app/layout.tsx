import './globals.css';
import { Providers } from './providers';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://1.234.83.118'),
  title: 'OpenPLAT',
  description: '카카오톡 기반 고객 응대 자동화 플랫폼 - 실시간 CS 자동 응답 시스템 관리',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'OpenPLAT - 고객 응대 자동화 플랫폼',
    description: '카카오톡 기반 CS 자동 응답 시스템을 관리하고, AI 학습 현황을 모니터링하세요.',
    siteName: 'OpenPLAT',
    locale: 'ko_KR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenPLAT - 고객 응대 자동화 플랫폼',
    description: '카카오톡 기반 CS 자동 응답 시스템을 관리하고, AI 학습 현황을 모니터링하세요.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
