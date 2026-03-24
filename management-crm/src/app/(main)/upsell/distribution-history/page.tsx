'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiGet } from '@/lib/api-client';

interface Member {
  id: number;
  displayName: string;
  role: string;
  total: number;
  periodTotal: number;
}

interface DayRow {
  date: string;
  total: number;
  perMember: Record<number, number>;
}

interface HistoryData {
  members: Member[];
  rows: DayRow[];
  days: number;
}

const ROLE_LABELS: Record<string, string> = { upselling_director: '실장', upselling_chief: '주임', upselling_staff: '사원' };

export default function DistributionHistoryPage() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet<HistoryData>(`/api/upsell/distribution/history?days=${days}`);
      setData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>로딩중...</div>;
  if (!data) return <div style={{ padding: 32, color: '#ef4444' }}>데이터를 불러올 수 없습니다.</div>;

  const { members, rows } = data;
  const maxTotal = Math.max(...members.map(m => m.total), 1);

  return (
    <div className="crm-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>분배 현황</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>팀원별 가망 배분 이력을 확인합니다.</p>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
          <option value={7}>최근 7일</option>
          <option value={14}>최근 14일</option>
          <option value={30}>최근 30일</option>
          <option value={60}>최근 60일</option>
          <option value={90}>최근 90일</option>
        </select>
      </div>

      {/* 팀원별 누적 현황 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(members.length, 4)}, 1fr)`, gap: 12, marginBottom: 24 }}>
        {members.map(m => (
          <div key={m.id} style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px',
            borderLeft: m.role === 'upselling_director' ? '3px solid #8b5cf6' : '3px solid #2563eb',
          }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>{m.displayName} ({ROLE_LABELS[m.role]})</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a' }}>{m.total}건</div>
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(m.total / maxTotal) * 100}%`, height: '100%', background: m.role === 'upselling_director' ? '#8b5cf6' : '#2563eb', borderRadius: 3 }} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>최근 {days}일: +{m.periodTotal}건</div>
          </div>
        ))}
      </div>

      {/* 일자별 이력 테이블 */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#475569', fontWeight: 600 }}>날짜</th>
                {members.map(m => (
                  <th key={m.id} style={{ padding: '10px 8px', textAlign: 'center', color: m.role === 'upselling_director' ? '#8b5cf6' : '#475569', fontWeight: 600 }}>
                    {m.displayName}
                  </th>
                ))}
                <th style={{ padding: '10px 8px', textAlign: 'center', color: '#0f172a', fontWeight: 700 }}>합계</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={members.length + 2} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>배분 이력이 없습니다.</td></tr>
              ) : rows.map(row => (
                <tr key={row.date} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 500, color: '#0f172a', whiteSpace: 'nowrap' }}>
                    {new Date(row.date + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
                  </td>
                  {members.map(m => {
                    const count = row.perMember[m.id] || 0;
                    return (
                      <td key={m.id} style={{
                        padding: '8px', textAlign: 'center', fontWeight: count > 0 ? 600 : 400,
                        color: count > 0 ? (m.role === 'upselling_director' ? '#8b5cf6' : '#2563eb') : '#cbd5e1',
                      }}>
                        {count > 0 ? count : '-'}
                      </td>
                    );
                  })}
                  <td style={{ padding: '8px', textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>{row.total}</td>
                </tr>
              ))}
              {/* 기간 합계 행 */}
              {rows.length > 0 && (
                <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>합계</td>
                  {members.map(m => (
                    <td key={m.id} style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, color: m.role === 'upselling_director' ? '#8b5cf6' : '#0f172a' }}>
                      {m.periodTotal}
                    </td>
                  ))}
                  <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>
                    {members.reduce((s, m) => s + m.periodTotal, 0)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
