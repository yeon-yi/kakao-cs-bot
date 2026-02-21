'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Zap, BarChart3 } from 'lucide-react';

const TABS = [
  { id: 'daily', label: '일별 분석', icon: BarChart3 },
  { id: 'cost', label: 'AI 비용 상세', icon: DollarSign },
] as const;

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-emerald-100 text-emerald-700',
  gemini: 'bg-blue-100 text-blue-700',
  anthropic: 'bg-orange-100 text-orange-700',
};

function shortModel(model: string) {
  if (!model) return '-';
  return model.replace('models/', '').replace('gemini-', 'G-').replace('gpt-', 'GPT-').replace('claude-', 'C-');
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<'daily' | 'cost'>('daily');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 30 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: dailyData, isLoading: dailyLoading } = trpc.analytics.daily.useQuery(
    { startDate, endDate },
    { enabled: tab === 'daily' }
  );
  const { data: costData, isLoading: costLoading } = trpc.analytics.costBreakdown.useQuery(
    { startDate, endDate },
    { enabled: tab === 'cost' }
  );

  const isLoading = tab === 'daily' ? dailyLoading : costLoading;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">분석</h1>
        <p className="mt-1 text-sm text-zinc-500">봇 운영 지표와 AI 비용을 확인합니다</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-5 border-b border-zinc-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}>
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 날짜 선택 */}
      <div className="mb-5 flex gap-3 items-end">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">시작일</label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.currentTarget.value)} className="w-44" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">종료일</label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.currentTarget.value)} className="w-44" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : tab === 'daily' ? (
        /* ============ 일별 분석 탭 ============ */
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50">
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">날짜</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600">총 메시지</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600">자동 응답</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600">에스컬레이션</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600">평균 응답시간</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600">AI 비용</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600">정확도</th>
                </tr>
              </thead>
              <tbody>
                {dailyData?.data.map((row) => (
                  <tr key={row.date} className="border-b last:border-0 hover:bg-zinc-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-zinc-900">{row.date}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{row.totalMessages.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{row.autoResponses.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{row.adminEscalations}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{row.avgResponseTime ? `${row.avgResponseTime}ms` : '-'}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">${row.aiCost.toFixed(4)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{(row.accuracy * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {(!dailyData?.data || dailyData.data.length === 0) && (
                  <tr><td colSpan={7} className="px-4 py-16 text-center text-zinc-400">데이터가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* ============ AI 비용 상세 탭 ============ */
        <div className="space-y-6">

          {/* 모델별 총 비용 요약 */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 mb-3">모델별 비용 요약</h2>
            {costData?.modelTotals && costData.modelTotals.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {costData.modelTotals.map((m) => (
                  <Card key={m.model} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-zinc-900 font-mono">{shortModel(m.model)}</p>
                        <Badge className={`mt-1 text-[10px] ${PROVIDER_COLORS[m.provider] || 'bg-zinc-100 text-zinc-600'}`}>
                          {m.provider}
                        </Badge>
                      </div>
                      <p className="text-lg font-bold text-zinc-900">${m.cost.toFixed(4)}</p>
                    </div>
                    <div className="flex gap-4 text-xs text-zinc-400 mt-2">
                      <span>{m.calls}회 호출</span>
                      <span>IN {m.inputTokens.toLocaleString()}</span>
                      <span>OUT {m.outputTokens.toLocaleString()}</span>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-8 text-center text-zinc-400 text-sm">
                체인 비용 데이터가 없습니다. 멀티모델 체인이 사용되면 여기에 표시됩니다.
              </Card>
            )}
          </div>

          {/* 일별 비용 테이블 */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 mb-3">일별 체인 비용</h2>
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-zinc-50">
                      <th className="px-4 py-3 text-left font-medium text-zinc-600">날짜</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-600">대화 수</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-600">비용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costData?.dailyTotals?.map((row) => (
                      <tr key={row.date} className="border-b last:border-0 hover:bg-zinc-50/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-zinc-900">{row.date}</td>
                        <td className="px-4 py-3 text-right text-zinc-600">{row.conversations}건</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-900">${row.cost.toFixed(4)}</td>
                      </tr>
                    ))}
                    {(!costData?.dailyTotals || costData.dailyTotals.length === 0) && (
                      <tr><td colSpan={3} className="px-4 py-12 text-center text-zinc-400">체인 비용 데이터 없음</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* 일별 모델별 상세 */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 mb-3">일별 모델별 상세</h2>
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-zinc-50">
                      <th className="px-4 py-3 text-left font-medium text-zinc-600">날짜</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-600">모델</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-600">Provider</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-600">호출</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-600">IN 토큰</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-600">OUT 토큰</th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-600">비용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costData?.dailyByModel?.map((row, i) => (
                      <tr key={`${row.date}-${row.model}-${i}`} className="border-b last:border-0 hover:bg-zinc-50/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-zinc-900">{row.date}</td>
                        <td className="px-4 py-3 text-zinc-700 font-mono text-xs">{shortModel(row.model)}</td>
                        <td className="px-4 py-3">
                          <Badge className={`text-[10px] ${PROVIDER_COLORS[row.provider] || 'bg-zinc-100 text-zinc-600'}`}>
                            {row.provider}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-600">{row.calls}</td>
                        <td className="px-4 py-3 text-right text-zinc-600">{row.inputTokens.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-zinc-600">{row.outputTokens.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-900">${row.cost.toFixed(4)}</td>
                      </tr>
                    ))}
                    {/* 단일 모델 대화 (chain_steps 없음) */}
                    {costData?.dailySingle?.map((row, i) => (
                      <tr key={`single-${row.date}-${row.model}-${i}`} className="border-b last:border-0 hover:bg-zinc-50/50 transition-colors bg-zinc-50/30">
                        <td className="px-4 py-3 font-medium text-zinc-900">{row.date}</td>
                        <td className="px-4 py-3 text-zinc-700 font-mono text-xs">{shortModel(row.model)}</td>
                        <td className="px-4 py-3">
                          <Badge className="text-[10px] bg-zinc-100 text-zinc-500">single</Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-600">{row.calls}</td>
                        <td className="px-4 py-3 text-right text-zinc-400">-</td>
                        <td className="px-4 py-3 text-right text-zinc-400">-</td>
                        <td className="px-4 py-3 text-right text-zinc-400">
                          <span className="text-[10px]">{row.avgTime}ms avg</span>
                        </td>
                      </tr>
                    ))}
                    {(!costData?.dailyByModel?.length && !costData?.dailySingle?.length) && (
                      <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-400">비용 데이터가 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
