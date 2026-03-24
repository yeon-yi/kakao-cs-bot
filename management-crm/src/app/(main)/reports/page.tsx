'use client';

import { useState, useEffect, useCallback } from 'react';
import { ROLE_LABELS, UPSELLING_ROLES } from '@/lib/constants';

/* ─────────────────────────── Types ─────────────────────────── */

interface AuthUser {
  userId: number;
  username: string;
  role: string;
  displayName: string;
  branch: string;
}

interface SalesRow {
  name: string;
  total: number;
  completed: number;
  completionRate: number;
  revenue: number;
  holdingCount: number;
}

interface UpsellRow {
  name: string;
  role: string;
  assignCount: number;
  paidCount: number;
  revenue: number;
  reviewDone: number;
}

interface SalesResponse {
  team: 'sales';
  rows: SalesRow[];
  summary: { total: number; completed: number; completionRate: number; revenue: number; holdingCount: number };
}

interface UpsellResponse {
  team: 'upsell';
  rows: UpsellRow[];
  summary: { assignCount: number; paidCount: number; revenue: number; reviewDone: number };
}

interface ManagementRow {
  displayName: string;
  role: string;
  mgmtPosition: string | null;
  responsibilities: string | null;
  totalRegistered: number;
  successCount: number;
  failCount: number;
  lastRegisteredAt: string | null;
}

interface ManagementResponse {
  team: 'management';
  rows: ManagementRow[];
  summary: { totalRegistered: number; successCount: number; failCount: number };
}

/* ─────────────────────── Helpers ─────────────────────── */

function formatCurrency(n: number): string {
  if (!n) return '0원';
  const eok = Math.floor(n / 100000000);
  const man = Math.round((n % 100000000) / 10000);
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${eok}억원`;
  if (man > 0) return `${man.toLocaleString()}만원`;
  return n.toLocaleString('ko-KR') + '원';
}

function getDefaultDates() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    startDate: `${y}-${m}-01`,
    endDate: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
  };
}

/* ─────────────────────── Component ─────────────────────── */

export default function ReportsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [team, setTeam] = useState<'sales' | 'upsell' | 'management'>('sales');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [salesData, setSalesData] = useState<SalesResponse | null>(null);
  const [upsellData, setUpsellData] = useState<UpsellResponse | null>(null);
  const [managementData, setManagementData] = useState<ManagementResponse | null>(null);

  // Init: fetch auth, set defaults
  useEffect(() => {
    const defaults = getDefaultDates();
    setStartDate(defaults.startDate);
    setEndDate(defaults.endDate);

    fetch('/api/auth')
      .then((r) => r.json())
      .then((data) => {
        const u: AuthUser = data.user;
        setUser(u);
        const isUpsell = (UPSELLING_ROLES as readonly string[]).includes(u.role);
        setTeam(isUpsell ? 'upsell' : 'sales');
      })
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ team, startDate, endDate });
      const res = await fetch(`/api/reports/performance?${params}`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      if (team === 'sales') {
        setSalesData(data as SalesResponse);
        setUpsellData(null);
        setManagementData(null);
      } else if (team === 'upsell') {
        setUpsellData(data as UpsellResponse);
        setSalesData(null);
        setManagementData(null);
      } else {
        setManagementData(data as ManagementResponse);
        setSalesData(null);
        setUpsellData(null);
      }
    } catch {
      alert('데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [team, startDate, endDate]);

  // Auto-fetch when user loaded and team/dates set
  useEffect(() => {
    if (user && startDate && endDate) {
      fetchData();
    }
  }, [user, team]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─────── CSV Export ─────── */
  const exportCsv = () => {
    let csvContent = '';
    if (team === 'sales' && salesData) {
      csvContent = '담당자,업체수,완료,완료율(%),매출,홀딩\n';
      for (const r of salesData.rows) {
        csvContent += `${r.name},${r.total},${r.completed},${r.completionRate},${r.revenue},${r.holdingCount}\n`;
      }
      const s = salesData.summary;
      csvContent += `합계,${s.total},${s.completed},${s.completionRate},${s.revenue},${s.holdingCount}\n`;
    } else if (team === 'upsell' && upsellData) {
      csvContent = '담당자,직급,배분수,결제완료,매출,리뷰달성\n';
      for (const r of upsellData.rows) {
        csvContent += `${r.name},${ROLE_LABELS[r.role] || r.role},${r.assignCount},${r.paidCount},${r.revenue},${r.reviewDone}\n`;
      }
      const s = upsellData.summary;
      csvContent += `합계,,${s.assignCount},${s.paidCount},${s.revenue},${s.reviewDone}\n`;
    } else if (team === 'management' && managementData) {
      csvContent = '등록자,등록건수,성공,실패,마지막 등록일\n';
      for (const r of managementData.rows) {
        csvContent += `${r.displayName},${r.totalRegistered},${r.successCount},${r.failCount},${r.lastRegisteredAt || '-'}\n`;
      }
      const s = managementData.summary;
      csvContent += `합계,${s.totalRegistered},${s.successCount},${s.failCount},\n`;
    }
    if (!csvContent) return;

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `성과리포트_${team}_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const accent = team === 'upsell' ? '#8b5cf6' : team === 'management' ? '#f59e0b' : '#2563eb';

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b', fontSize: '14px' }}>
        로딩중...
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1200px', margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', margin: '0 0 16px 0', letterSpacing: '-0.02em' }}>
          성과 리포트
        </h1>

        {/* Controls */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center',
          padding: '16px 20px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px',
        }}>
          {/* Team Toggle */}
          <div style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            <button
              onClick={() => setTeam('sales')}
              style={{
                padding: '7px 16px', fontSize: '13px', fontWeight: team === 'sales' ? 600 : 400, cursor: 'pointer',
                backgroundColor: team === 'sales' ? '#2563eb' : '#ffffff',
                color: team === 'sales' ? '#ffffff' : '#64748b',
                border: 'none', fontFamily: 'inherit',
                transition: 'background-color 0.15s, color 0.15s',
              }}
            >
              영업팀
            </button>
            <button
              onClick={() => setTeam('upsell')}
              style={{
                padding: '7px 16px', fontSize: '13px', fontWeight: team === 'upsell' ? 600 : 400, cursor: 'pointer',
                backgroundColor: team === 'upsell' ? '#8b5cf6' : '#ffffff',
                color: team === 'upsell' ? '#ffffff' : '#64748b',
                border: 'none', borderLeft: '1px solid #e2e8f0', fontFamily: 'inherit',
                transition: 'background-color 0.15s, color 0.15s',
              }}
            >
              업셀팀
            </button>
            <button
              onClick={() => setTeam('management')}
              style={{
                padding: '7px 16px', fontSize: '13px', fontWeight: team === 'management' ? 600 : 400, cursor: 'pointer',
                backgroundColor: team === 'management' ? '#f59e0b' : '#ffffff',
                color: team === 'management' ? '#ffffff' : '#64748b',
                border: 'none', borderLeft: '1px solid #e2e8f0', fontFamily: 'inherit',
                transition: 'background-color 0.15s, color 0.15s',
              }}
            >
              관리팀
            </button>
          </div>

          {/* Date Range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                padding: '6px 10px', fontSize: '13px', border: '1px solid #e2e8f0', borderRadius: '6px',
                color: '#334155', fontFamily: 'inherit', outline: 'none',
              }}
            />
            <span style={{ color: '#94a3b8', fontSize: '13px' }}>~</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                padding: '6px 10px', fontSize: '13px', border: '1px solid #e2e8f0', borderRadius: '6px',
                color: '#334155', fontFamily: 'inherit', outline: 'none',
              }}
            />
          </div>

          {/* Fetch Button */}
          <button
            onClick={fetchData}
            disabled={loading}
            style={{
              padding: '7px 20px', fontSize: '13px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              backgroundColor: accent, color: '#ffffff', border: 'none', borderRadius: '6px',
              fontFamily: 'inherit', opacity: loading ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {loading ? '조회중...' : '조회'}
          </button>

          {/* CSV Export */}
          <button
            onClick={exportCsv}
            disabled={!salesData && !upsellData && !managementData}
            style={{
              padding: '7px 16px', fontSize: '13px', fontWeight: 500, cursor: (!salesData && !upsellData && !managementData) ? 'not-allowed' : 'pointer',
              backgroundColor: '#ffffff', color: '#334155', border: '1px solid #e2e8f0', borderRadius: '6px',
              fontFamily: 'inherit', opacity: (!salesData && !upsellData && !managementData) ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            CSV 내보내기
          </button>
        </div>
      </div>

      {/* Table Card */}
      <div style={{
        backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
            데이터를 불러오는 중...
          </div>
        ) : team === 'sales' ? (
          <SalesTable data={salesData} accent={accent} />
        ) : team === 'upsell' ? (
          <UpsellTable data={upsellData} accent={accent} />
        ) : (
          <ManagementTable data={managementData} accent={accent} />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── Sales Table ─────────────────────── */

function SalesTable({ data, accent }: { data: SalesResponse | null; accent: string }) {
  if (!data || data.rows.length === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
        조회된 데이터가 없습니다.
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: '12px', fontWeight: 600, color: '#64748b',
    textAlign: 'left', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap', letterSpacing: '-0.01em',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: '13px', color: '#334155',
    borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap',
  };
  const summaryTd: React.CSSProperties = {
    ...tdStyle, fontWeight: 600, backgroundColor: '#f8fafc', borderBottom: 'none',
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>담당자</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>업체수</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>완료</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>완료율</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>매출</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>홀딩</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.name}>
              <td style={tdStyle}>{r.name}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{r.total}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{r.completed}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                  backgroundColor: r.completionRate >= 80 ? '#dcfce7' : r.completionRate >= 50 ? '#fef9c3' : '#fee2e2',
                  color: r.completionRate >= 80 ? '#166534' : r.completionRate >= 50 ? '#854d0e' : '#991b1b',
                }}>
                  {r.completionRate}%
                </span>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.revenue)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: r.holdingCount > 0 ? '#dc2626' : '#94a3b8' }}>{r.holdingCount}</td>
            </tr>
          ))}
          {/* Summary row */}
          <tr>
            <td style={{ ...summaryTd, color: accent }}>합계</td>
            <td style={{ ...summaryTd, textAlign: 'right' }}>{data.summary.total}</td>
            <td style={{ ...summaryTd, textAlign: 'right' }}>{data.summary.completed}</td>
            <td style={{ ...summaryTd, textAlign: 'right' }}>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                backgroundColor: '#e0e7ff', color: '#3730a3',
              }}>
                {data.summary.completionRate}%
              </span>
            </td>
            <td style={{ ...summaryTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(data.summary.revenue)}</td>
            <td style={{ ...summaryTd, textAlign: 'right', color: data.summary.holdingCount > 0 ? '#dc2626' : '#94a3b8' }}>{data.summary.holdingCount}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────── Upsell Table ─────────────────────── */

function UpsellTable({ data, accent }: { data: UpsellResponse | null; accent: string }) {
  if (!data || data.rows.length === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
        조회된 데이터가 없습니다.
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: '12px', fontWeight: 600, color: '#64748b',
    textAlign: 'left', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap', letterSpacing: '-0.01em',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: '13px', color: '#334155',
    borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap',
  };
  const summaryTd: React.CSSProperties = {
    ...tdStyle, fontWeight: 600, backgroundColor: '#f8fafc', borderBottom: 'none',
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>담당자</th>
            <th style={thStyle}>직급</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>배분수</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>결제완료</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>매출</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>리뷰달성</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.name}>
              <td style={tdStyle}>{r.name}</td>
              <td style={tdStyle}>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500,
                  backgroundColor: '#f3e8ff', color: '#7c3aed',
                }}>
                  {ROLE_LABELS[r.role] || r.role}
                </span>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{r.assignCount}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                <span style={{ color: r.paidCount > 0 ? '#059669' : '#94a3b8' }}>{r.paidCount}</span>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(r.revenue)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                <span style={{ color: r.reviewDone > 0 ? '#059669' : '#94a3b8' }}>{r.reviewDone}</span>
              </td>
            </tr>
          ))}
          {/* Summary row */}
          <tr>
            <td style={{ ...summaryTd, color: accent }}>합계</td>
            <td style={summaryTd}></td>
            <td style={{ ...summaryTd, textAlign: 'right' }}>{data.summary.assignCount}</td>
            <td style={{ ...summaryTd, textAlign: 'right' }}>{data.summary.paidCount}</td>
            <td style={{ ...summaryTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(data.summary.revenue)}</td>
            <td style={{ ...summaryTd, textAlign: 'right' }}>{data.summary.reviewDone}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────── Management Table ─────────────────────── */

function ManagementTable({ data, accent }: { data: ManagementResponse | null; accent: string }) {
  if (!data || data.rows.length === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>
        조회된 데이터가 없습니다.
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: '12px', fontWeight: 600, color: '#64748b',
    textAlign: 'left', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap', letterSpacing: '-0.01em',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 16px', fontSize: '13px', color: '#334155',
    borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap',
  };
  const summaryTd: React.CSSProperties = {
    ...tdStyle, fontWeight: 600, backgroundColor: '#f8fafc', borderBottom: 'none',
  };

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>등록자</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>등록건수</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>성공</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>실패</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>마지막 등록일</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.displayName}>
              <td style={tdStyle}>{r.displayName}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{r.totalRegistered}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                <span style={{ color: r.successCount > 0 ? '#059669' : '#94a3b8' }}>{r.successCount}</span>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                <span style={{ color: r.failCount > 0 ? '#dc2626' : '#94a3b8' }}>{r.failCount}</span>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', color: '#64748b' }}>{formatDate(r.lastRegisteredAt)}</td>
            </tr>
          ))}
          {/* Summary row */}
          <tr>
            <td style={{ ...summaryTd, color: accent }}>합계</td>
            <td style={{ ...summaryTd, textAlign: 'right' }}>{data.summary.totalRegistered}</td>
            <td style={{ ...summaryTd, textAlign: 'right' }}>{data.summary.successCount}</td>
            <td style={{ ...summaryTd, textAlign: 'right' }}>{data.summary.failCount}</td>
            <td style={summaryTd}></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
