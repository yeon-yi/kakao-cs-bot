'use client';

import { trpc } from '@/lib/trpc';

function StatCard({ title, value, unit, alert }: { title: string; value: number | string; unit?: string; alert?: boolean }) {
  return (
    <div className={cn('rounded-lg border bg-card p-4', alert && 'border-destructive')}>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-bold">
        {typeof value === 'number' ? value.toLocaleString() : value}
        {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}

import { cn } from '@/lib/utils';

export default function DashboardPage() {
  const { data: summary, isLoading } = trpc.analytics.summary.useQuery();

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">로딩 중...</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">대시보드</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="총 메시지 (30일)"
          value={summary?.totalMessages ?? 0}
          unit="건"
        />
        <StatCard
          title="자동 응답률"
          value={`${((summary?.autoResponseRate ?? 0) * 100).toFixed(1)}%`}
        />
        <StatCard
          title="에스컬레이션율"
          value={`${((summary?.escalationRate ?? 0) * 100).toFixed(1)}%`}
          alert={(summary?.escalationRate ?? 0) > 0.1}
        />
        <StatCard
          title="AI 비용 (30일)"
          value={`$${(summary?.totalCost ?? 0).toFixed(2)}`}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-lg font-semibold">정확도</h2>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold">
              {((summary?.accuracy ?? 0) * 100).toFixed(1)}%
            </div>
            <div className="text-sm text-muted-foreground">
              사용자 피드백 기반
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-lg font-semibold">기간</h2>
          <p className="text-sm text-muted-foreground">
            {summary?.period?.start} ~ {summary?.period?.end}
          </p>
        </div>
      </div>
    </div>
  );
}
