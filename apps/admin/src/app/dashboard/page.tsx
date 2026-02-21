'use client';

import { trpc } from '@/lib/trpc';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import {
  Activity, TrendingUp, AlertTriangle, DollarSign, Clock, Target,
  MessageSquare, Users, BookOpen, Zap, BarChart3, MessagesSquare,
  Brain, CheckCircle2, TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const iconMap = {
  messages: Activity,
  response: TrendingUp,
  escalation: AlertTriangle,
  cost: DollarSign,
  pending: Clock,
  accuracy: Target,
  chat: MessageSquare,
  users: Users,
  knowledge: BookOpen,
  speed: Zap,
  chart: BarChart3,
  rooms: MessagesSquare,
  brain: Brain,
  check: CheckCircle2,
  trending: TrendingDown,
};

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  icon: keyof typeof iconMap;
  alert?: boolean;
  color?: string;
  sub?: string;
}

function StatCard({ title, value, unit, icon, alert, color = 'blue', sub }: StatCardProps) {
  const Icon = iconMap[icon];
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    violet: 'bg-violet-50 text-violet-600',
    cyan: 'bg-cyan-50 text-cyan-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    pink: 'bg-pink-50 text-pink-600',
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
          {sub && <p className="mt-1 text-xs text-zinc-400">{sub}</p>}
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
  const { data: today } = trpc.analytics.today.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: learning } = trpc.analytics.learningRate.useQuery(undefined, {
    refetchInterval: 300_000,
  });
  const { data: uncertaintyCount } = trpc.uncertainty.openCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      {/* 오늘 실시간 */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">대시보드</h1>
        <p className="mt-1 text-sm text-zinc-500">실시간 현황 (1분마다 갱신)</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 mb-8">
        <StatCard
          title="오늘 메시지"
          value={today?.totalMessages ?? 0}
          unit="건"
          icon="chat"
          color="blue"
          sub={`자동응답 ${today?.autoResponses ?? 0}건`}
        />
        <StatCard
          title="활성 채팅방"
          value={today?.activeRooms ?? 0}
          unit="개"
          icon="rooms"
          color="indigo"
        />
        <StatCard
          title="오늘 사용자"
          value={today?.uniqueUsers ?? 0}
          unit="명"
          icon="users"
          color="green"
        />
        <StatCard
          title="평균 응답시간"
          value={today?.avgResponseTime ?? 0}
          unit="ms"
          icon="speed"
          color="cyan"
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
          title="평균 신뢰도"
          value={`${((today?.avgConfidence ?? 0) * 100).toFixed(0)}%`}
          icon="accuracy"
          color="amber"
        />
        <StatCard
          title="지식 항목"
          value={today?.knowledgeCount ?? 0}
          unit="개"
          icon="knowledge"
          color="violet"
        />
        <StatCard
          title="AI 비용 (30일)"
          value={`$${(summary?.totalCost ?? 0).toFixed(2)}`}
          icon="cost"
          color="pink"
        />
      </div>

      {/* AI 학습 현황 */}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-zinc-800">AI 학습 현황</h2>
        <p className="text-xs text-zinc-400">이번 주 학습 진행 상태</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-8">
        <StatCard
          title="금주 신규 지식"
          value={learning?.newKnowledgeThisWeek ?? 0}
          unit="건"
          icon="brain"
          color="violet"
          sub={`학습 완료 ${learning?.learnedThisWeek ?? 0}건`}
        />
        <StatCard
          title="에스컬레이션 추이"
          value={learning?.escalationsThisWeek ?? 0}
          unit="건"
          icon="trending"
          color={(learning?.escalationsTrend ?? 0) <= 0 ? 'green' : 'red'}
          sub={`전주 대비 ${(learning?.escalationsTrend ?? 0) > 0 ? '+' : ''}${learning?.escalationsTrend ?? 0}건`}
        />
        <StatCard
          title="불확실 주제"
          value={uncertaintyCount?.count ?? 0}
          unit="건"
          icon="escalation"
          color="amber"
          alert={(uncertaintyCount?.count ?? 0) > 10}
        />
        <StatCard
          title="지식 검증율"
          value={learning?.verification?.total
            ? `${Math.round((learning.verification.verified / learning.verification.total) * 100)}%`
            : '0%'}
          icon="check"
          color="green"
          sub={`${learning?.verification?.verified ?? 0}/${learning?.verification?.total ?? 0} 검증됨`}
        />
      </div>

      {/* 30일 요약 */}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-zinc-800">30일 요약</h2>
        <p className="text-xs text-zinc-400">
          {summary?.period?.start} ~ {summary?.period?.end}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-8">
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
          title="응답 정확도"
          value={`${((summary?.accuracy ?? 0) * 100).toFixed(1)}%`}
          icon="accuracy"
          color="cyan"
        />
      </div>

      {/* 최근 대화 */}
      {today?.recentRooms && today.recentRooms.length > 0 && (
        <>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-zinc-800">최근 대화</h2>
          </div>
          <Card>
            <div className="divide-y divide-zinc-100">
              {today.recentRooms.map((r: any) => (
                <div key={`${r.room_id}-${r.created_at}`} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-800 truncate">{r.room_id}</span>
                      {r.user_name && (
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500">
                          {r.user_name}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-400 truncate">{r.user_message}</p>
                  </div>
                  <span className="ml-3 shrink-0 text-[10px] text-zinc-300">
                    {new Date(r.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
