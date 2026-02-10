'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export default function AnalyticsPage() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 30 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading } = trpc.analytics.daily.useQuery({ startDate, endDate });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">분석</h1>

      <div className="mb-4 flex gap-4">
        <div>
          <label className="mb-1 block text-sm">시작일</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.currentTarget.value)}
            className="rounded-md border px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm">종료일</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.currentTarget.value)}
            className="rounded-md border px-3 py-2 text-sm" />
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">로딩 중...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">날짜</th>
                <th className="px-4 py-3 text-right font-medium">총 메시지</th>
                <th className="px-4 py-3 text-right font-medium">자동 응답</th>
                <th className="px-4 py-3 text-right font-medium">에스컬레이션</th>
                <th className="px-4 py-3 text-right font-medium">평균 응답시간</th>
                <th className="px-4 py-3 text-right font-medium">AI 비용</th>
                <th className="px-4 py-3 text-right font-medium">정확도</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((row) => (
                <tr key={row.date} className="border-b hover:bg-muted/25">
                  <td className="px-4 py-3">{row.date}</td>
                  <td className="px-4 py-3 text-right">{row.totalMessages}</td>
                  <td className="px-4 py-3 text-right">{row.autoResponses}</td>
                  <td className="px-4 py-3 text-right">{row.adminEscalations}</td>
                  <td className="px-4 py-3 text-right">{row.avgResponseTime ?? '-'}ms</td>
                  <td className="px-4 py-3 text-right">${row.aiCost.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right">{(row.accuracy * 100).toFixed(1)}%</td>
                </tr>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">데이터 없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
