'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet } from '@/lib/api-client';
import { useSSERefresh } from '@/lib/useSSE';

interface Stats {
  totalCompanies: number;
  totalAssigned: number;
  totalProducts: number;
  productsWithSettings: number;
  settingRate: number;
  totalReviews: number;
  confirmedReviews: number;
  monthlyRevenue: number;
  expiringCount: number;
}

interface MemberStat {
  displayName: string;
  role: string;
  count: number;
}

interface RecentAssignment {
  id: number;
  assignedAt: string;
  company: { companyName: string; representative: string; paymentDate: string; branch: string };
  assignedTo: { displayName: string };
}

interface MonthlyTrend {
  month: string;
  revenue: number;
  count: number;
}

interface MemberPerformance {
  displayName: string;
  role: string;
  assignCount: number;
  paidCount: number;
  revenue: number;
  reviewDone: number;
}

interface DashboardData {
  stats: Stats;
  memberStats: MemberStat[];
  recentAssignments: RecentAssignment[];
  paymentStats: { paid: number; partial: number; unpaid: number };
  monthlyTrend: MonthlyTrend[];
  processingStats: {
    powerlink: { total: number; done: number };
    review: { total: number; done: number };
    channel: { total: number; done: number };
  };
  memberPerformance: MemberPerformance[];
  paidIncomplete: number;
}

interface TodayContact {
  companyId: number;
  companyName: string;
  phone: string;
  representative: string;
  nextAction: string | null;
  consultantName: string;
}

interface ActivityMember {
  displayName: string;
  role: string;
  actions: { action: string; count: number }[];
}

const ROLE_LABELS: Record<string, string> = {
  upselling_director: '실장',
  upselling_chief: '주임',
  upselling_staff: '사원',
};

function ProgressBar({ value, max, color = '#8b5cf6' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? '#22c55e' : color, borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function fmtRevenue(won: number): string {
  if (!won) return '0원';
  const eok = Math.floor(won / 100000000);
  const man = Math.round((won % 100000000) / 10000);
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${eok}억원`;
  return `${man.toLocaleString()}만원`;
}

export default function UpsellDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [todayContacts, setTodayContacts] = useState<TodayContact[]>([]);
  const [teamActivity, setTeamActivity] = useState<ActivityMember[]>([]);
  const [userRole, setUserRole] = useState<string>('');

  const loadData = useCallback(() => {
    apiGet<DashboardData>('/api/upsell/dashboard')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
    apiGet<{ contacts: TodayContact[] }>('/api/upsell/dashboard/today-contacts')
      .then((r) => setTodayContacts(r.contacts))
      .catch(console.error);
    apiGet<{ members: ActivityMember[] }>('/api/upsell/dashboard/activity')
      .then((r) => setTeamActivity(r.members))
      .catch(console.error);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Get user role for conditional rendering
  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setUserRole(d.user?.role || ''))
      .catch(() => {});
  }, []);

  useSSERefresh(
    ['company_updated', 'assignment_changed', 'product_updated', 'distribution_changed', 'payment_updated'],
    loadData,
  );

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>로딩중...</div>;
  if (!data) return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ color: '#ef4444', marginBottom: 16 }}>데이터를 불러올 수 없습니다.</div>
      <button onClick={() => { setLoading(true); loadData(); }}
        style={{ padding: '8px 20px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>다시 시도</button>
    </div>
  );

  const { stats, memberStats, recentAssignments, paymentStats, monthlyTrend, processingStats, memberPerformance, paidIncomplete } = data;

  const cards = [
    { label: '전체 업체', value: stats.totalCompanies.toLocaleString(), color: '#2563eb', link: '/upsell/companies' },
    { label: '분배 완료', value: stats.totalAssigned.toLocaleString(), color: '#8b5cf6', link: '/upsell/companies' },
    { label: '상품 설정률', value: `${stats.settingRate}%`, color: '#22c55e', link: '/upsell/companies' },
    { label: '확인 리뷰', value: `${stats.confirmedReviews}/${stats.totalReviews}`, color: '#f59e0b', link: '/upsell/companies' },
    { label: '이번달 매출', value: fmtRevenue(stats.monthlyRevenue), color: '#06b6d4', link: '/upsell/companies?paymentStatus=paid' },
    { label: '만료 임박', value: stats.expiringCount.toString(), color: stats.expiringCount > 0 ? '#ef4444' : '#94a3b8', link: '/upsell/companies?expiring=true' },
  ];

  const paymentTotal = paymentStats.paid + paymentStats.partial + paymentStats.unpaid;
  const maxRevenue = Math.max(...monthlyTrend.map(m => m.revenue), 1);

  return (
    <div className="crm-page">
      <h1>업셀링 대시보드</h1>

      {/* 결제완료 but 서비스 미완료 알림 */}
      {paidIncomplete > 0 && (
        <div onClick={() => router.push('/upsell/companies?paymentStatus=paid')}
          style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', transition: 'border-color 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#f59e0b'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#fde68a'; }}>
          <span style={{ fontSize: 13, color: '#92400e', fontWeight: 500 }}>⚠️ 결제완료 but 서비스 미완료 <b>{paidIncomplete}건</b> — 처리가 필요합니다</span>
        </div>
      )}

      {/* 통계 카드 */}
      <div className="grid-stats" style={{ marginBottom: 24 }}>
        {cards.map((card) => (
          <div key={card.label} onClick={() => router.push(card.link)}
            style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '20px 16px', cursor: 'pointer', transition: 'border-color 0.15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#8b5cf6'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{card.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* 오늘 할 일 */}
      {(todayContacts.length > 0 || stats.expiringCount > 0) && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            오늘 할 일
            <span style={{ fontSize: 11, fontWeight: 500, color: '#8b5cf6', background: '#f5f3ff', padding: '2px 8px', borderRadius: 10 }}>
              {todayContacts.length + (stats.expiringCount > 0 ? 1 : 0)}건
            </span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* 만료 임박 알림 */}
            {stats.expiringCount > 0 && (
              <div
                onClick={() => router.push('/upsell/companies?expiring=true')}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fef2f2', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>만료임박</span>
                <span style={{ color: '#991b1b', fontWeight: 500 }}>계약 만료 7일 이내 업체 <b>{stats.expiringCount}건</b></span>
              </div>
            )}
            {/* 오늘 연락할 업체 */}
            {todayContacts.map((c) => (
              <div
                key={c.companyId}
                onClick={() => router.push(`/upsell/companies?search=${encodeURIComponent(c.companyName)}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f8fafc', borderRadius: 6, cursor: 'pointer', fontSize: 13, transition: 'background 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f7ff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
              >
                <span style={{ color: '#8b5cf6', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>연락</span>
                <span style={{ fontWeight: 500, color: '#0f172a', minWidth: 80 }}>{c.companyName}</span>
                <span style={{ color: '#64748b', fontSize: 12 }}>{c.phone}</span>
                {c.nextAction && (
                  <span style={{ color: '#475569', fontSize: 12, marginLeft: 'auto', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.nextAction}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 오늘 팀원 활동 (실장/admin만) */}
      {(userRole === 'admin' || userRole === 'upselling_director') && teamActivity.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>오늘 팀원 활동</h2>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>팀원</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>상품설정</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>결제처리</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>리뷰확인</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>기타</th>
                </tr>
              </thead>
              <tbody>
                {teamActivity.map((m) => {
                  const getCount = (keyword: string) =>
                    m.actions.filter(a => a.action.includes(keyword)).reduce((s, a) => s + a.count, 0);
                  const productCount = getCount('상품') + getCount('설정') + getCount('product');
                  const paymentCount = getCount('결제') + getCount('payment');
                  const reviewCount = getCount('리뷰') + getCount('review');
                  const totalCount = m.actions.reduce((s, a) => s + a.count, 0);
                  const otherCount = totalCount - productCount - paymentCount - reviewCount;
                  return (
                    <tr key={m.displayName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 4px' }}>
                        <div style={{ fontWeight: 500 }}>{m.displayName}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{ROLE_LABELS[m.role] || m.role}</div>
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600, color: productCount > 0 ? '#8b5cf6' : '#cbd5e1' }}>{productCount || '-'}</td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600, color: paymentCount > 0 ? '#22c55e' : '#cbd5e1' }}>{paymentCount || '-'}</td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600, color: reviewCount > 0 ? '#f59e0b' : '#cbd5e1' }}>{reviewCount || '-'}</td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600, color: otherCount > 0 ? '#475569' : '#cbd5e1' }}>{otherCount || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 결제 현황 + 상품 처리율 */}
      <div className="grid-2col" style={{ marginBottom: 24 }}>
        {/* 결제 현황 */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>결제 현황</h2>
          {paymentTotal > 0 ? (
            <>
              {/* 결제 바 */}
              <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
                {paymentStats.paid > 0 && (
                  <div style={{ width: `${(paymentStats.paid / paymentTotal) * 100}%`, background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 600 }}>
                    {paymentStats.paid}
                  </div>
                )}
                {paymentStats.partial > 0 && (
                  <div style={{ width: `${(paymentStats.partial / paymentTotal) * 100}%`, background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 600 }}>
                    {paymentStats.partial}
                  </div>
                )}
                {paymentStats.unpaid > 0 && (
                  <div style={{ width: `${(paymentStats.unpaid / paymentTotal) * 100}%`, background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                    {paymentStats.unpaid}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
                <span onClick={() => router.push('/upsell/companies?paymentStatus=paid')}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', borderRadius: 4, padding: '2px 4px', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f0fdf4'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#22c55e', display: 'inline-block' }} />
                  결제완료 <b>{paymentStats.paid}</b>
                </span>
                <span onClick={() => router.push('/upsell/companies?paymentStatus=partial')}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', borderRadius: 4, padding: '2px 4px', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#fffbeb'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />
                  부분결제 <b>{paymentStats.partial}</b>
                </span>
                <span onClick={() => router.push('/upsell/companies?paymentStatus=unpaid')}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', borderRadius: 4, padding: '2px 4px', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: '#e2e8f0', display: 'inline-block' }} />
                  미결제 <b>{paymentStats.unpaid}</b>
                </span>
              </div>
            </>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 16 }}>결제 데이터가 없습니다.</div>
          )}
        </div>

        {/* 상품 처리율 */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>상품 처리율</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: '#475569' }}>파워링크</span>
                <span style={{ color: '#64748b' }}>{processingStats.powerlink.done}/{processingStats.powerlink.total}</span>
              </div>
              <ProgressBar value={processingStats.powerlink.done} max={processingStats.powerlink.total} color="#2563eb" />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: '#475569' }}>리뷰 달성</span>
                <span style={{ color: '#64748b' }}>{processingStats.review.done}/{processingStats.review.total}</span>
              </div>
              <ProgressBar value={processingStats.review.done} max={processingStats.review.total} color="#f59e0b" />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ color: '#475569' }}>채널 완료</span>
                <span style={{ color: '#64748b' }}>{processingStats.channel.done}/{processingStats.channel.total}</span>
              </div>
              <ProgressBar value={processingStats.channel.done} max={processingStats.channel.total} color="#8b5cf6" />
            </div>
          </div>
        </div>
      </div>

      {/* 월별 매출 추이 (CSS 바 차트) */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>월별 매출 추이</h2>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160 }}>
          {monthlyTrend.map((m) => {
            const barH = maxRevenue > 0 ? Math.max(4, (m.revenue / maxRevenue) * 140) : 4;
            return (
              <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>
                  {m.revenue > 0 ? fmtRevenue(m.revenue) : '-'}
                </div>
                <div style={{
                  width: '100%', maxWidth: 48, height: barH, borderRadius: '4px 4px 0 0',
                  background: m.month === monthlyTrend[monthlyTrend.length - 1]?.month ? '#8b5cf6' : '#c4b5fd',
                  transition: 'height 0.3s',
                }} />
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{m.month.split('-')[1]}월</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 팀원별 성과 + 최근 분배 */}
      <div className="grid-2col" style={{ marginBottom: 24 }}>
        {/* 팀원별 상세 성과 */}
        {memberPerformance.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>팀원별 성과</h2>
            <div className="table-wrap" style={{ border: 'none' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>이름</th>
                    <th style={{ textAlign: 'right', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>분배</th>
                    <th style={{ textAlign: 'right', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>결제</th>
                    <th style={{ textAlign: 'right', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>리뷰</th>
                    <th style={{ textAlign: 'right', padding: '8px 4px', color: '#64748b', fontWeight: 500, fontSize: 12 }}>매출</th>
                  </tr>
                </thead>
                <tbody>
                  {memberPerformance.map((m) => (
                    <tr key={m.displayName} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 4px' }}>
                        <div style={{ fontWeight: 500 }}>{m.displayName}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{ROLE_LABELS[m.role] || m.role}</div>
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600, color: '#8b5cf6' }}>{m.assignCount}</td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600, color: '#22c55e' }}>{m.paidCount}</td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600, color: '#f59e0b' }}>{m.reviewDone}</td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 600 }}>
                        {m.revenue > 0 ? fmtRevenue(m.revenue) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 최근 분배 */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 16 }}>최근 분배 업체</h2>
          {recentAssignments.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: 13, padding: 16, textAlign: 'center' }}>분배 내역이 없습니다.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentAssignments.map((a) => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <div>
                    <span style={{ fontWeight: 500 }}>{a.company.companyName}</span>
                    <span style={{ color: '#94a3b8', marginLeft: 8, fontSize: 12 }}>{a.company.branch}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    <span style={{ color: '#8b5cf6', fontSize: 12 }}>{a.assignedTo.displayName}</span>
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>{new Date(a.assignedAt).toLocaleDateString('ko-KR')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
