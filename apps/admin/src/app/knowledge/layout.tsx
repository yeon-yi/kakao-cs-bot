'use client';

import { AppShell } from '@/components/app-shell';

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
