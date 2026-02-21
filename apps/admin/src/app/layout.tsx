import './globals.css';
import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <title>CS Bot Admin</title>
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
