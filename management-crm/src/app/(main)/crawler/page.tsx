'use client';

import { useEffect, useState, useCallback } from 'react';

interface CrawlerLog {
  id: number;
  createdAt: string;
  status: string;
  newCount: number;
  updateCount: number;
  totalScanned: number;
  duration: number;
  errorMessage: string | null;
}

interface CrawlerResponse {
  logs: CrawlerLog[];
}

export default function CrawlerPage() {
  const [logs, setLogs] = useState<CrawlerLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchCrawler = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/crawler', { credentials: 'include' });
      if (!res.ok) throw new Error('크롤러 정보를 불러올 수 없습니다.');
      const json: CrawlerResponse = await res.json();
      setLogs(json.logs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCrawler();
  }, [fetchCrawler]);

  function formatDateTime(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
  }

  function formatDuration(ms: number): string {
    if (!ms && ms !== 0) return '-';
    if (ms < 1000) return `${ms}ms`;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    return `${mins}m ${remainSecs}s`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-[3px] border-[#e2e8f0] border-t-[#2563eb] rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#64748b] text-sm">로딩중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <div className="bg-[#fef2f2] border border-[#fecaca] px-4 py-3 text-[#dc2626] text-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0f172a] tracking-tight">크롤링 설정</h1>
          <p className="text-[#64748b] text-sm mt-1">자동 크롤링 상태 및 실행 이력을 확인합니다.</p>
        </div>
        <button
          onClick={fetchCrawler}
          className="h-9 px-4 text-[13px] font-medium text-[#475569] bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] transition-colors duration-100 flex items-center gap-1.5 cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13.5 8a5.5 5.5 0 01-9.95 3.18M2.5 8a5.5 5.5 0 019.95-3.18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M13.5 3v3h-3M2.5 13v-3h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          새로고침
        </button>
      </div>

      {/* Status card — shows latest log entry */}
      {logs.length > 0 && (() => {
        const latest = logs[0];
        return (
          <div className="bg-white border border-[#e2e8f0] p-5 mb-6">
            <h2 className="text-[14px] font-semibold text-[#64748b] uppercase tracking-wider mb-4">마지막 크롤링</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
              <div>
                <span className="block text-[12px] text-[#94a3b8] mb-1">실행 시각</span>
                <span className="text-[14px] font-medium text-[#0f172a]">
                  {formatDateTime(latest.createdAt)}
                </span>
              </div>
              <div>
                <span className="block text-[12px] text-[#94a3b8] mb-1">상태</span>
                <StatusBadge status={latest.status} />
              </div>
              <div>
                <span className="block text-[12px] text-[#94a3b8] mb-1">신규</span>
                <span className="text-[18px] font-bold text-[#2563eb]">
                  {latest.newCount.toLocaleString()}
                </span>
                <span className="text-[13px] text-[#94a3b8] ml-1">건</span>
              </div>
              <div>
                <span className="block text-[12px] text-[#94a3b8] mb-1">업데이트</span>
                <span className="text-[18px] font-bold text-[#0f172a]">
                  {latest.updateCount.toLocaleString()}
                </span>
                <span className="text-[13px] text-[#94a3b8] ml-1">건</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Log table */}
      <div className="bg-white border border-[#e2e8f0]">
        <div className="px-5 py-4 border-b border-[#e2e8f0]">
          <h2 className="text-[15px] font-semibold text-[#0f172a]">실행 이력</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">일시</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">상태</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap text-right">신규</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap text-right">업데이트</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap text-right">스캔</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap text-right">소요시간</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">오류</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-[#94a3b8] text-sm">
                    실행 이력이 없습니다.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] transition-colors duration-100"
                  >
                    <td className="px-5 py-3 text-[13px] text-[#94a3b8] whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#0f172a] font-medium text-right tabular-nums">
                      {log.newCount.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#0f172a] font-medium text-right tabular-nums">
                      {log.updateCount.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#475569] text-right tabular-nums">
                      {log.totalScanned.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#475569] text-right whitespace-nowrap tabular-nums">
                      {formatDuration(log.duration)}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#dc2626] max-w-[240px] truncate">
                      {log.errorMessage || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isSuccess = status === 'success';
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[12px] font-medium"
      style={{
        backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
        color: isSuccess ? '#16a34a' : '#dc2626',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full inline-block"
        style={{ backgroundColor: isSuccess ? '#22c55e' : '#ef4444' }}
      />
      {isSuccess ? '성공' : '실패'}
    </span>
  );
}
