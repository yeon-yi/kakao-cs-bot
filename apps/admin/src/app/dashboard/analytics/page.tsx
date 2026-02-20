'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export default function AnalyticsPage() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 30 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading } = trpc.analytics.daily.useQuery({ startDate, endDate });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">일별 분석</h1>
        <p className="mt-1 text-sm text-zinc-500">날짜별 봇 운영 지표를 확인합니다</p>
      </div>

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
      ) : (
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
                {data?.data.map((row) => (
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
                {(!data?.data || data.data.length === 0) && (
                  <tr><td colSpan={7} className="px-4 py-16 text-center text-zinc-400">데이터가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
