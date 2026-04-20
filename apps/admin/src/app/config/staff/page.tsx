'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import StaffTab from './_tabs/staff-tab';
import AssigneesTab from './_tabs/assignees-tab';

const TABS = [
  { value: 'staff', label: '직원 목록' },
  { value: 'assignees', label: '담당자 배정' },
];

function StaffPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'staff';

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.replace(`/config/staff?${params.toString()}`);
  };

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="직원 관리"
        subtitle="직원 기본정보와 담당자 배정 규칙을 관리합니다"
      />
      <Tabs items={TABS} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'staff' && <StaffTab />}
      {tab === 'assignees' && <AssigneesTab />}
    </div>
  );
}

export default function StaffPage() {
  return (
    <Suspense fallback={<LoadingSpinner fullPage />}>
      <StaffPageInner />
    </Suspense>
  );
}
