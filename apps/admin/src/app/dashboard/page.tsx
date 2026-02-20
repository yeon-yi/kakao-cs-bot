'use client';

import { trpc } from '@/lib/trpc';
import { Card, CardTitle, CardValue, CardDescription } from '@/components/ui/card';
import { Activity, TrendingUp, AlertTriangle, DollarSign, Clock, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

const iconMap = {
  messages: Activity,
  response: TrendingUp,
  escalation: AlertTriangle,
  cost: DollarSign,
  pending: Clock,
  accuracy: Target,
};

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  icon: keyof typeof iconMap;
  alert?: boolean;
  color?: string;
}

function StatCard({ title, value, unit, icon, alert, color = 'blue' }: StatCardProps) {
  const Icon = iconMap[icon];
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    violet: 'bg-violet-50 text-violet-600',
    cyan: 'bg-cyan-50 text-cyan-600',
  };

  return (
    <Card className={cn(alert && 'ring-2 ring-red-200 border-red-200')}>
      <div className="flex items-start justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardValue className="mt-2">
            {typeof value === 'number' ? value.toLocaleString() : value}
            {unit && <span className="ml-1 text-sm font-normal text-zinc-400">{unit}</span>}
          </CardValue>
        </div>
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', colorMap[color])}>
          <Icon size={18} />
        </div>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: summary, isLoading } = trpc.analytics.summary.useQuery();
  const { data: pendingData } = trpc.escalation.pendingCount.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">대시보드</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {summary?.period?.start} ~ {summary?.period?.end} 기간 요약
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="총 메시지"
          value={summary?.totalMessages ?? 0}
          unit="건"
          icon="messages"
          color="blue"
        />
        <StatCard
          title="자동 응답률"
          value={`${((summary?.autoResponseRate ?? 0) * 100).toFixed(1)}%`}
          icon="response"
          color="green"
        />
        <StatCard
          title="에스컬레이션율"
          value={`${((summary?.escalationRate ?? 0) * 100).toFixed(1)}%`}
          icon="escalation"
          color="amber"
          alert={(summary?.escalationRate ?? 0) > 0.1}
        />
        <StatCard
          title="AI 비용"
          value={`$${(summary?.totalCost ?? 0).toFixed(2)}`}
          icon="cost"
          color="violet"
        />
        <StatCard
          title="대기중 에스컬레이션"
          value={pendingData?.count ?? 0}
          unit="건"
          icon="pending"
          color="red"
          alert={(pendingData?.count ?? 0) > 0}
        />
        <StatCard
          title="응답 정확도"
          value={`${((summary?.accuracy ?? 0) * 100).toFixed(1)}%`}
          icon="accuracy"
          color="cyan"
        />
      </div>
    </div>
  );
}
