'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Tabs } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Activity, AlertTriangle, Clock, Smartphone } from 'lucide-react';
import DashboardOverviewTab from './_tabs/overview';
import DashboardAnalyticsTab from './_tabs/analytics';
import DashboardDevicesTab from './_tabs/devices';

const TABS = [
  { value: 'overview', label: '현황' },
  { value: 'analytics', label: '분석' },
  { value: 'devices', label: '연결 기기' },
];

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'overview';

  // KPI 4개는 기존 쿼리들에서 조립:
  //   - 오늘 메시지 수: analytics.today.totalMessages
  //   - 에스컬레이션율: analytics.summary.escalationRate (30일 기준, 0~1)
  //   - 평균 응답시간: analytics.today.avgResponseTime (ms)
  //   - 온라인 기기: devices.summary { online, total, error }
  const { data: todayStats } = trpc.analytics.today.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: summaryStats } = trpc.analytics.summary.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: deviceSummary } = trpc.devices.summary.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.replace(`/dashboard?${params.toString()}`);
  };

  const escalationRate = summaryStats?.escalationRate ?? 0;
  const avgResponseMs = todayStats?.avgResponseTime ?? 0;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="운영 현황" subtitle="봇 운영 주요 지표를 한눈에 확인합니다" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <StatCard
          title="오늘 메시지"
          value={todayStats?.totalMessages ?? 0}
          icon={Activity}
          onClick={() => setTab('analytics')}
        />
        <StatCard
          title="에스컬레이션율"
          value={(escalationRate * 100).toFixed(1)}
          unit="%"
          icon={AlertTriangle}
          alert={escalationRate > 0.2}
        />
        <StatCard
          title="평균 응답시간"
          value={avgResponseMs ? (avgResponseMs / 1000).toFixed(1) : '0'}
          unit="초"
          icon={Clock}
        />
        <StatCard
          title="온라인 기기"
          value={deviceSummary ? `${deviceSummary.online}/${deviceSummary.total}` : '0/0'}
          icon={Smartphone}
          alert={deviceSummary ? deviceSummary.error > 0 : false}
          warn={deviceSummary ? deviceSummary.total > 0 && deviceSummary.online === 0 : false}
          onClick={() => setTab('devices')}
        />
      </div>

      <Tabs items={TABS} value={tab} onChange={setTab} className="mb-4" />

      {tab === 'overview' && <DashboardOverviewTab />}
      {tab === 'analytics' && <DashboardAnalyticsTab />}
      {tab === 'devices' && <DashboardDevicesTab />}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingSpinner fullPage />}>
      <DashboardInner />
    </Suspense>
  );
}
