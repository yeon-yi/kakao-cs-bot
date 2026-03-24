import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "관리 CRM",
  description: "업체 관리 시스템",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
