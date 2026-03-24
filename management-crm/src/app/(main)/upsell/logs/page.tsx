'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiGet } from '@/lib/api-client';
import Pagination from '@/components/Pagination';

interface LogEntry {
  id: number;
  action: string;
  details: string | null;
  createdAt: string;
  user: { displayName: string; role: string };
}

const ROLE_LABELS: Record<string, string> = {
  upselling_director: '실장',
  upselling_chief: '주임',
  upselling_staff: '사원',
};

export default function UpsellLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const pageSize = 50;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const data = await apiGet<{ logs: LogEntry[]; total: number }>(`/api/upsell/logs?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, startDate, endDate]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="crm-page">
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>활동 내역</h1>

      <div className="filter-bar">
        <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
        <span style={{ color: '#94a3b8' }}>~</span>
        <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b' }}>총 {total}건</div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ textAlign: 'left', padding: '10px 16px', color: '#64748b', fontWeight: 500, width: 160 }}>일시</th>
              <th style={{ textAlign: 'left', padding: '10px 16px', color: '#64748b', fontWeight: 500, width: 100 }}>사용자</th>
              <th style={{ textAlign: 'left', padding: '10px 16px', color: '#64748b', fontWeight: 500, width: 120 }}>활동</th>
              <th style={{ textAlign: 'left', padding: '10px 16px', color: '#64748b', fontWeight: 500 }}>상세</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>로딩중...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>활동 내역이 없습니다.</td></tr>
            ) : logs.map((l) => (
              <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 16px', color: '#64748b', fontSize: 12 }}>{new Date(l.createdAt).toLocaleString('ko-KR')}</td>
                <td style={{ padding: '10px 16px' }}>
                  <span style={{ fontWeight: 500 }}>{l.user.displayName}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>{ROLE_LABELS[l.user.role] || ''}</span>
                </td>
                <td style={{ padding: '10px 16px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12,
                    background: l.action.includes('분배') ? '#ede9fe' : l.action.includes('삭제') ? '#fef2f2' : '#f0f9ff',
                    color: l.action.includes('분배') ? '#7c3aed' : l.action.includes('삭제') ? '#dc2626' : '#0284c7',
                  }}>{l.action}</span>
                </td>
                <td style={{ padding: '10px 16px', color: '#374151' }}>{l.details || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
