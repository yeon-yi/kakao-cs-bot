'use client';

import { trpc } from '@/lib/trpc';
import {
  Activity, TrendingUp, AlertTriangle, DollarSign, Clock, Target,
  MessageSquare, Users, BookOpen, Zap, BarChart3, MessagesSquare,
  Brain, CheckCircle2, TrendingDown, Link2,
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
  chain: Link2,
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

const accentColors: Record<string, string> = {
  blue: 'bg-blue-600',
  green: 'bg-emerald-600',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  violet: 'bg-violet-600',
  cyan: 'bg-teal-600',
  indigo: 'bg-indigo-600',
  pink: 'bg-pink-500',
};

const iconColors: Record<string, string> = {
  blue: 'text-blue-600',
  green: 'text-emerald-600',
  amber: 'text-amber-500',
  red: 'text-red-500',
  violet: 'text-violet-600',
  cyan: 'text-teal-600',
  indigo: 'text-indigo-600',
  pink: 'text-pink-500',
};

function StatCard({ title, value, unit, icon, alert, color = 'blue', sub }: StatCardProps) {
  const Icon = iconMap[icon];

  return (
    <div className={cn(
      'relative overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-white p-4 shadow-sm',
      alert && 'border-red-300',
    )}>
      <div className={cn('absolute left-0 top-0 bottom-0 w-[3px]', accentColors[color])} />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[hsl(var(--muted))] truncate">{title}</p>
          <p className="mt-1.5 text-xl font-bold text-[hsl(var(--foreground))] tracking-tight">
            {typeof value === 'number' ? value.toLocaleString() : value}
            {unit && <span className="ml-1 text-xs font-normal text-[hsl(var(--muted))]">{unit}</span>}
          </p>
          {sub && <p className="mt-1 text-[11px] text-[hsl(var(--muted))]">{sub}</p>}
        </div>
        <Icon size={16} className={cn('shrink-0 mt-0.5', iconColors[color])} />
      </div>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h2>
      {description && (
        <span className="text-[11px] text-[hsl(var(--muted))]">{description}</span>
      )}
    </div>
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
  const { data: chainStats } = trpc.analytics.chainStats.useQuery(undefined, {
    refetchInterval: 300_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
      </div>
    );
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}. ${String(now.getMonth() + 1).padStart(2, '0')}. ${String(now.getDate()).padStart(2, '0')}`;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-bold text-[hsl(var(--foreground))]">대시보드</h1>
          <p className="mt-0.5 text-xs text-[hsl(var(--muted))]">실시간 현황 (1분 갱신)</p>
        </div>
        <span className="text-xs text-[hsl(var(--muted))]">{dateStr}</span>
      </div>

      {/* 오늘 실시간 */}
      <SectionHeader title="오늘 현황" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 mb-7">
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

      {/* Divider */}
      <hr className="border-[hsl(var(--border))] mb-6" />

      {/* AI 학습 현황 */}
      <SectionHeader title="AI 학습 현황" description="이번 주 학습 진행" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-7">
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

      {/* AI 체인 현황 */}
      {chainStats && chainStats.totalResponses > 0 && (
        <>
          <hr className="border-[hsl(var(--border))] mb-6" />
          <SectionHeader title="AI 체인 현황" description="최근 7일 멀티모델 통계" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-7">
            <StatCard
              title="체인 사용률"
              value={`${(chainStats.chainRate * 100).toFixed(0)}%`}
              icon="chain"
              color="indigo"
              sub={`${chainStats.chainCount}/${chainStats.totalResponses}건`}
            />
            <StatCard
              title="주 모델"
              value={chainStats.models?.[0]?.model || '-'}
              icon="brain"
              color="violet"
              sub={chainStats.models?.[0] ? `${chainStats.models[0].count}회 사용` : ''}
            />
            <StatCard
              title="체인 응답시간"
              value={chainStats.avgChainTime}
              unit="ms"
              icon="speed"
              color="cyan"
            />
            <StatCard
              title="체인 비용 (7일)"
              value={`$${chainStats.totalChainCost.toFixed(4)}`}
              icon="cost"
              color="pink"
            />
          </div>
        </>
      )}

      {/* 30일 요약 */}
      <hr className="border-[hsl(var(--border))] mb-6" />
      <SectionHeader
        title="30일 요약"
        description={summary?.period ? `${summary.period.start} ~ ${summary.period.end}` : undefined}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-7">
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
          <hr className="border-[hsl(var(--border))] mb-6" />
          <SectionHeader title="최근 대화" />
          <div className="rounded-lg border border-[hsl(var(--border))] bg-white shadow-sm">
            <div className="divide-y divide-[hsl(var(--border))]">
              {today.recentRooms.map((r: any) => (
                <div key={`${r.room_id}-${r.created_at}`} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[hsl(var(--foreground))] truncate">{r.room_id}</span>
                      {r.user_name && (
                        <span className="shrink-0 rounded bg-[hsl(var(--secondary))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted))]">
                          {r.user_name}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted))] truncate">{r.user_message}</p>
                  </div>
                  <span className="ml-3 shrink-0 text-[10px] text-[hsl(var(--muted))]">
                    {new Date(r.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
