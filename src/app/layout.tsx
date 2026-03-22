import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Palm Oil Manager — 삼양식품 기초원료구매팀',
  description: '팜유 구매관리 시스템',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={inter.variable}>
      <body className={`${inter.className} min-h-screen bg-slate-50`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
