'use client';

import { AppShell } from '@/components/app-shell';

export default function IdentityLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
