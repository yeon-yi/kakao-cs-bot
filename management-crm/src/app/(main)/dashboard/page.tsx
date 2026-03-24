'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSSERefresh } from '@/lib/useSSE';

interface StaffStat { name: string; total: number; completed: number; inProgress: number; notSet: number; }
interface BranchStat { name: string; total: number; completed: number; holding: number; revenue: number; rate: number; }
interface ExpiringCompany { id: number; companyName: string; staffName: string; managerName: string; branch: string; setting: { contractEnd: string } | null; }
interface Alerts { noSettingOld: number; expiringWeek: number; }

interface DashboardData {
  todayNew: number;
  totalCompanies: number;
  holdingCount: number;
  expiringCount: number;
  monthlyRevenue: number;
  todayContactCount: number;
  statusCounts: { active: number; completed: number; churned: number };
  solutionSummary: { notSet: number; inProgress: number; completed: number };
  recentCompanies: {
    id: number; companyName: string; representative: string; managerName: string; paymentDate: string;
    setting: { isHolding: boolean; contractEnd: string | null; hasReward: boolean; blogTarget: number; instaTarget: number; hasHomepage: boolean; videoType: string } | null;
    progress: { rewardDone: boolean; blogCount: number; instaCount: number; homepageDone: boolean; videoDone: boolean } | null;
  }[];
  staffStats: StaffStat[];
  branchStats: BranchStat[];
  expiringCompanies: ExpiringCompany[];
  alerts: Alerts;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');

  const loadData = useCallback(() => {
    const params = new URLSearchParams();
    if (filterStart) params.set('startDate', filterStart);
    if (filterEnd) params.set('endDate', filterEnd);
    const qs = params.toString() ? `?${params}` : '';
    fetch(`/api/dashboard${qs}`, { credentials: 'include' })
      .then((res) => { if (!res.ok) throw new Error('데이터를 불러올 수 없습니다.'); return res.json(); })
      .then((json) => { setData(json); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [filterStart, filterEnd]);

  useEffect(() => { loadData(); }, [loadData]);

  // SSE 실시간 반영
  useSSERefresh(['company_updated'], loadData);

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="text-center">
        <div className="w-8 h-8 border-[3px] border-[#e2e8f0] border-t-[#2563eb] rounded-full animate-spin mx-auto mb-3" />
        <p className="text-[#64748b] text-sm">데이터를 불러오는 중...</p>
      </div>
    </div>
  );
  if (error) return <div className="p-8"><div className="bg-[#fef2f2] border border-[#fecaca] px-4 py-3 text-[#dc2626] text-sm">{error}</div></div>;
  if (!data) return null;

  function fmtRevenue(won: number): string {
    if (!won) return '0원';
    const eok = Math.floor(won / 100000000);
    const man = Math.round((won % 100000000) / 10000);
    if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만원`;
    if (eok > 0) return `${eok}억원`;
    return `${man.toLocaleString()}만원`;
  }

  const sTotal = data.solutionSummary.notSet + data.solutionSummary.inProgress + data.solutionSummary.completed;
  const cPct = sTotal > 0 ? (data.solutionSummary.completed / sTotal) * 100 : 0;
  const iPct = sTotal > 0 ? (data.solutionSummary.inProgress / sTotal) * 100 : 0;
  const nPct = sTotal > 0 ? (data.solutionSummary.notSet / sTotal) * 100 : 0;

  return (
    <div className="p-6 lg:p-8 max-w-[1400px]">
      <div className="mb-6" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="text-[22px] font-bold text-[#0f172a] tracking-tight">대시보드</h1>
          <p className="text-[#64748b] text-sm mt-1">업체 현황을 한눈에 확인합니다.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }} />
          <span style={{ color: '#94a3b8' }}>~</span>
          <input type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }} />
          {(filterStart || filterEnd) && (
            <button onClick={() => { setFilterStart(''); setFilterEnd(''); }}
              style={{ padding: '6px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, cursor: 'pointer', color: '#64748b' }}>
              초기화
            </button>
          )}
        </div>
      </div>

      {/* Today contacts alert */}
      {data.todayContactCount > 0 && (
        <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: 8 }}>
          <span style={{ fontSize: '13px', color: '#1e40af', fontWeight: 500 }}>📞 오늘 연락할 업체 <b>{data.todayContactCount}건</b></span>
        </div>
      )}

      {/* Alerts */}
      {(data.alerts.noSettingOld > 0 || data.alerts.expiringWeek > 0) && (
        <div className="mb-6 space-y-2">
          {data.alerts.noSettingOld > 0 && (
            <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1.5L1 16h16L9 1.5z" stroke="#d97706" strokeWidth="1.5" strokeLinejoin="round"/><path d="M9 7v3.5" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round"/><circle cx="9" cy="13" r=".6" fill="#d97706"/></svg>
              <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 500 }}>솔루션 미설정 방치 업체 <b>{data.alerts.noSettingOld}건</b> (결제 후 7일 이상 경과)</span>
            </div>
          )}
          {data.alerts.expiringWeek > 0 && (
            <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="#dc2626" strokeWidth="1.5"/><path d="M9 5v4.5l2.5 1.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span style={{ fontSize: '13px', color: '#991b1b', fontWeight: 500 }}>계약 만료 임박 <b>{data.alerts.expiringWeek}건</b> (7일 이내)</span>
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: '오늘 신규', value: String(data.todayNew), color: '#2563eb', bg: '#eff6ff' },
          { label: '전체 업체', value: String(data.totalCompanies), color: '#0f172a', bg: '#f1f5f9' },
          { label: '홀딩', value: String(data.holdingCount), color: '#d97706', bg: '#fffbeb' },
          { label: '만료 임박 (30일)', value: String(data.expiringCount), color: '#dc2626', bg: '#fef2f2' },
          { label: '이번달 매출', value: fmtRevenue(data.monthlyRevenue), color: '#06b6d4', bg: '#ecfeff' },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-[#e2e8f0] p-5">
            <span className="text-[#64748b] text-[12px] font-medium">{c.label}</span>
            <div className="font-bold tracking-tight mt-1" style={{ color: c.color, fontSize: c.value.length > 8 ? '20px' : '28px' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Status breakdown — 해지 업체가 있을 때만 표시 */}
      {data.statusCounts.churned > 0 && (
        <div className="flex gap-3 mb-4 text-[13px]">
          <span style={{ background: '#fecaca', padding: '4px 10px', borderRadius: 4, color: '#dc2626' }}>해지 업체 <b>{data.statusCounts.churned}</b>건</span>
        </div>
      )}

      {/* Solution summary bar */}
      <div className="bg-white border border-[#e2e8f0] p-5 mb-6">
        <h2 className="text-[14px] font-semibold text-[#0f172a] mb-3">솔루션 현황</h2>
        {sTotal > 0 && (
          <>
            <div className="w-full h-3 bg-[#f1f5f9] overflow-hidden flex mb-3">
              {cPct > 0 && <div style={{ width: `${cPct}%`, backgroundColor: '#22c55e' }} className="h-full" />}
              {iPct > 0 && <div style={{ width: `${iPct}%`, backgroundColor: '#2563eb' }} className="h-full" />}
              {nPct > 0 && <div style={{ width: `${nPct}%`, backgroundColor: '#e2e8f0' }} className="h-full" />}
            </div>
            <div className="flex flex-wrap gap-6 text-[13px]">
              <span className="flex items-center gap-2"><span className="w-3 h-3 inline-block" style={{ backgroundColor: '#22c55e' }} /> 완료 <b>{data.solutionSummary.completed.toLocaleString()}</b></span>
              <span className="flex items-center gap-2"><span className="w-3 h-3 inline-block" style={{ backgroundColor: '#2563eb' }} /> 진행중 <b>{data.solutionSummary.inProgress.toLocaleString()}</b></span>
              <span className="flex items-center gap-2"><span className="w-3 h-3 inline-block" style={{ backgroundColor: '#e2e8f0' }} /> 미설정 <b>{data.solutionSummary.notSet.toLocaleString()}</b></span>
            </div>
          </>
        )}
      </div>

      {/* Two-column: branch stats + expiring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Branch stats */}
        <div className="bg-white border border-[#e2e8f0]">
          <div className="px-5 py-3 border-b border-[#e2e8f0]">
            <h2 className="text-[14px] font-semibold text-[#0f172a]">지사별 현황</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                  <th className="px-4 py-2.5 font-semibold text-[#64748b] text-[12px]">지사</th>
                  <th className="px-4 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">전체</th>
                  <th className="px-4 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">완료</th>
                  <th className="px-4 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">홀딩</th>
                  <th className="px-4 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">매출</th>
                  <th className="px-4 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">완료율</th>
                </tr>
              </thead>
              <tbody>
                {data.branchStats.map((b) => (
                  <tr key={b.name} className="border-b border-[#f1f5f9]">
                    <td className="px-4 py-2.5 font-medium text-[#0f172a]">{b.name}</td>
                    <td className="px-4 py-2.5 text-right text-[#475569]">{b.total}</td>
                    <td className="px-4 py-2.5 text-right text-[#16a34a] font-medium">{b.completed}</td>
                    <td className="px-4 py-2.5 text-right text-[#d97706]">{b.holding}</td>
                    <td className="px-4 py-2.5 text-right text-[#06b6d4] font-medium">{fmtRevenue(b.revenue)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span style={{ fontSize: '12px', fontWeight: 600, padding: '1px 6px', backgroundColor: b.rate >= 80 ? '#f0fdf4' : b.rate >= 40 ? '#eff6ff' : '#fef2f2', color: b.rate >= 80 ? '#16a34a' : b.rate >= 40 ? '#2563eb' : '#dc2626' }}>
                        {b.rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Expiring companies */}
        <div className="bg-white border border-[#e2e8f0]">
          <div className="px-5 py-3 border-b border-[#e2e8f0]">
            <h2 className="text-[14px] font-semibold text-[#0f172a]">만료 임박 업체 (7일 이내)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                  <th className="px-4 py-2.5 font-semibold text-[#64748b] text-[12px]">업체명</th>
                  <th className="px-4 py-2.5 font-semibold text-[#64748b] text-[12px]">담당자</th>
                  <th className="px-4 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">만료일</th>
                </tr>
              </thead>
              <tbody>
                {data.expiringCompanies.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-[#94a3b8] text-[13px]">만료 임박 업체가 없습니다.</td></tr>
                ) : data.expiringCompanies.map((c) => {
                  const dday = c.setting?.contractEnd ? Math.ceil((new Date(c.setting.contractEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
                  return (
                    <tr key={c.id} className="border-b border-[#f1f5f9] cursor-pointer hover:bg-[#f8fafc]" onClick={() => { window.location.href = `/companies/${c.id}`; }}>
                      <td className="px-4 py-2.5 font-medium text-[#0f172a]">{c.companyName}</td>
                      <td className="px-4 py-2.5 text-[#475569]">{c.staffName}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span style={{ fontSize: '12px', fontWeight: 600, color: dday <= 3 ? '#dc2626' : '#d97706' }}>D-{dday}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Staff performance */}
      <div className="bg-white border border-[#e2e8f0] mb-6">
        <div className="px-5 py-3 border-b border-[#e2e8f0]">
          <h2 className="text-[14px] font-semibold text-[#0f172a]">담당자별 실적</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px]">담당자</th>
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">전체</th>
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">완료</th>
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">진행중</th>
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px] text-right">미설정</th>
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px] text-right w-[140px]">진행률</th>
              </tr>
            </thead>
            <tbody>
              {data.staffStats.map((s) => {
                const rate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
                return (
                  <tr key={s.name} className="border-b border-[#f1f5f9]">
                    <td className="px-5 py-2.5 font-medium text-[#0f172a]">{s.name}</td>
                    <td className="px-5 py-2.5 text-right text-[#475569]">{s.total}</td>
                    <td className="px-5 py-2.5 text-right text-[#16a34a] font-medium">{s.completed}</td>
                    <td className="px-5 py-2.5 text-right text-[#2563eb]">{s.inProgress}</td>
                    <td className="px-5 py-2.5 text-right text-[#94a3b8]">{s.notSet}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2 justify-end">
                        <div style={{ width: '80px', height: '6px', backgroundColor: '#f1f5f9', overflow: 'hidden' }}>
                          <div style={{ width: `${rate}%`, height: '100%', backgroundColor: rate >= 80 ? '#22c55e' : rate >= 40 ? '#2563eb' : '#f59e0b' }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569', minWidth: '32px', textAlign: 'right' }}>{rate}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent companies */}
      <div className="bg-white border border-[#e2e8f0]">
        <div className="px-5 py-3 border-b border-[#e2e8f0]">
          <h2 className="text-[14px] font-semibold text-[#0f172a]">최근 등록 업체</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px]">업체명</th>
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px]">대표자</th>
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px]">담당자</th>
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px]">상태</th>
                <th className="px-5 py-2.5 font-semibold text-[#64748b] text-[12px]">등록일</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCompanies.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-[#94a3b8] text-sm">등록된 업체가 없습니다.</td></tr>
              ) : data.recentCompanies.map((c) => (
                <tr key={c.id} className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] cursor-pointer" onClick={() => { window.location.href = `/companies/${c.id}`; }}>
                  <td className="px-5 py-3 font-medium text-[#0f172a]">{c.companyName}</td>
                  <td className="px-5 py-3 text-[#475569]">{c.representative || '-'}</td>
                  <td className="px-5 py-3 text-[#475569]">{c.managerName || '-'}</td>
                  <td className="px-5 py-3"><StatusBadge company={c} /></td>
                  <td className="px-5 py-3 text-[#94a3b8]">{fmtDate(c.paymentDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ company }: { company: DashboardData['recentCompanies'][number] }) {
  let label = '미설정'; let bg = '#f1f5f9'; let text = '#64748b';
  if (company.setting) {
    if (company.setting.isHolding) { label = '홀딩'; bg = '#fffbeb'; text = '#d97706'; }
    else if (company.progress) {
      const s = company.setting; const p = company.progress;
      const allDone = (s.blogTarget <= 0 || p.blogCount >= s.blogTarget) && (s.instaTarget <= 0 || p.instaCount >= s.instaTarget) && (!s.hasHomepage || p.homepageDone) && (s.videoType === 'none' || p.videoDone);
      if (allDone) { label = '완료'; bg = '#f0fdf4'; text = '#16a34a'; } else { label = '진행중'; bg = '#eff6ff'; text = '#2563eb'; }
    } else { label = '설정됨'; bg = '#eff6ff'; text = '#2563eb'; }
  }
  return <span className="inline-block px-2 py-0.5 text-[12px] font-medium" style={{ backgroundColor: bg, color: text }}>{label}</span>;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
