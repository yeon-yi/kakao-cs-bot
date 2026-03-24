'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiGet, apiPost, apiDelete } from '@/lib/api-client';
import Pagination from '@/components/Pagination';
import { BRANCHES } from '@/lib/constants';
import { useSSERefresh } from '@/lib/useSSE';

interface Assignment {
  id: number;
  isExcluded: boolean;
  assignedTo: { id: number; displayName: string; role: string };
  product: {
    id: number;
    hasPowerlink: boolean;
    powerlinkDone: boolean;
    reviewType: string;
    receiptReviewTarget: number;
    kakaoReviewTarget: number;
    totalReviewTarget: number;
    receiptReviewCount: number;
    kakaoReviewCount: number;
    channelType: string;
    channelDone: boolean;
    upsellAmount: number | null;
    kakaoMapUrl: string | null;
    kakaoMapName: string | null;
    exposureCount: number;
    contractStart: string | null;
    contractEnd: string | null;
    paymentStatus: string;
    hasTaxInvoice: boolean;
  } | null;
}

interface UpsellCompany {
  id: number;
  sourceId: number;
  registrant: string;
  paymentDate: string;
  companyName: string;
  representative: string;
  phone: string;
  staffName: string;
  managerName: string;
  branch: string | null;
  paymentType: string | null;
  cardCompany: string | null;
  paymentAmount: number | null;
  installmentMonths: string | null;
  upsellAssignments: Assignment[];
  _canViewCardDetails: boolean;
  _isDuplicate: boolean;
  _isPinned: boolean;
}

interface DistMember {
  id: number;
  displayName: string;
  role: string;
  _count: { assignedUpsell: number };
}

interface AuthUser {
  userId: number;
  role: string;
}

const ROLE_LABELS: Record<string, string> = { upselling_director: '실장', upselling_chief: '주임', upselling_staff: '사원' };

type ViewTab = 'all' | 'mine';

export default function UpsellCompaniesPage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [companies, setCompanies] = useState<UpsellCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [branch, setBranch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [assigned, setAssigned] = useState('');
  const [excluded, setExcluded] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [expiringFilter, setExpiringFilter] = useState('');
  const [productStatusFilter, setProductStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('paymentDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [viewTab, setViewTab] = useState<ViewTab>('mine');
  const pageSize = 50;

  // 토스트 알림
  const [toast, setToast] = useState<string | null>(null);

  // 분배 관련 (실장만)
  const [selectedCompanies, setSelectedCompanies] = useState<Set<number>>(new Set());
  const [members, setMembers] = useState<DistMember[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<number>>(new Set());
  const [showDistPanel, setShowDistPanel] = useState(false);
  const [distributing, setDistributing] = useState(false);

  // 선택 유지를 위한 ref
  const selectedRef = useRef(selectedCompanies);
  selectedRef.current = selectedCompanies;

  const isDirector = authUser?.role === 'upselling_director' || authUser?.role === 'admin';

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      if (branch) params.set('branch', branch);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      // "내 업체" 탭이면 assigned=mine, "전체"면 assigned 필터 사용
      if (viewTab === 'mine') {
        params.set('assigned', 'mine');
      } else if (assigned) {
        params.set('assigned', assigned);
      }
      if (excluded) params.set('excluded', excluded);
      if (paymentFilter) params.set('paymentStatus', paymentFilter);
      if (expiringFilter) params.set('expiring', expiringFilter);
      if (productStatusFilter) params.set('productStatus', productStatusFilter);
      if (sortBy !== 'paymentDate' || sortDir !== 'desc') {
        params.set('sortBy', sortBy);
        params.set('sortDir', sortDir);
      }

      const data = await apiGet<{ companies: UpsellCompany[]; total: number }>(`/api/upsell/companies?${params}`);
      // 핀(즐겨찾기) 업체를 상단에 정렬
      const sorted = [...data.companies].sort((a, b) => {
        if (a._isPinned && !b._isPinned) return -1;
        if (!a._isPinned && b._isPinned) return 1;
        return 0;
      });
      setCompanies(sorted);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, branch, startDate, endDate, assigned, excluded, paymentFilter, expiringFilter, productStatusFilter, sortBy, sortDir, viewTab]);

  const loadMembers = useCallback(async () => {
    if (!isDirector) return;
    try {
      const data = await apiGet<{ members: DistMember[] }>('/api/upsell/distribution');
      setMembers(data.members);
    } catch (e) {
      console.error(e);
    }
  }, [isDirector]);

  useEffect(() => {
    apiGet<{ user: AuthUser }>('/api/auth').then((d) => setAuthUser(d.user)).catch(console.error);
  }, []);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { loadMembers(); }, [loadMembers]);

  // SSE 실시간 반영
  useSSERefresh(
    ['company_updated', 'assignment_changed', 'product_updated', 'distribution_changed', 'payment_updated'],
    loadCompanies,
  );

  const totalPages = Math.ceil(total / pageSize);

  const toggleCompany = (id: number) => {
    setSelectedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllOnPage = () => {
    const pageIds = companies.map((c) => c.id);
    setSelectedCompanies((prev) => {
      const allSelected = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleDistribute = async () => {
    if (selectedCompanies.size === 0 || selectedMembers.size === 0) return;

    const sel = members.filter(m => selectedMembers.has(m.id));
    const ids = Array.from(selectedCompanies);
    const total = ids.length;

    if (sel.length === 1) {
      // 1명 선택 → 전부 그 사람에게
      if (!confirm(`선택한 ${total}건을 ${sel[0].displayName}에게 분배하시겠습니까?`)) return;
      setDistributing(true);
      try {
        const result = await apiPost<{ message: string }>('/api/upsell/distribution', { companyIds: ids, assignToId: sel[0].id });
        alert(result.message);
        setSelectedCompanies(new Set());
        await Promise.all([loadCompanies(), loadMembers()]);
      } catch (e) { alert(e instanceof Error ? e.message : '분배 실패'); }
      finally { setDistributing(false); }
      return;
    }

    // 다중 선택 → 누적 균등 배분 (적게 받은 사람부터 채움)
    // 각 선택 팀원의 현재 누적 건수
    const memberTotals = sel.map(m => ({
      ...m,
      current: members.find(mm => mm.id === m.id)?._count.assignedUpsell || 0,
      addCount: 0,
    }));

    // 1건씩 가장 적은 사람에게 배분 시뮬레이션
    for (let i = 0; i < total; i++) {
      // 현재+배분 합이 가장 적은 사람 (동률이면 실장 우선 → 실장이 적게 가져감)
      memberTotals.sort((a, b) => {
        const diff = (a.current + a.addCount) - (b.current + b.addCount);
        if (diff !== 0) return diff;
        // 동률이면 실장이 뒤로 (나중에 받음 = 적게 받음)
        if (a.role === 'upselling_director') return 1;
        if (b.role === 'upselling_director') return -1;
        return 0;
      });
      memberTotals[0].addCount++;
    }

    const preview = memberTotals
      .sort((a, b) => b.addCount - a.addCount)
      .map(m => `${m.displayName}${m.role === 'upselling_director' ? '(실장)' : ''}: ${m.addCount}건 (누적 ${m.current}→${m.current + m.addCount})`)
      .join('\n');

    if (!confirm(`${total}건 누적 균등 배분:\n${preview}\n\n진행하시겠습니까?`)) return;

    setDistributing(true);
    try {
      // 팀원별로 배분 실행 — 부분 실패 시 알림
      let idx = 0;
      let completedMembers = 0;
      const sortedForExec = [...memberTotals].sort((a, b) => b.addCount - a.addCount);
      for (const m of sortedForExec) {
        if (m.addCount > 0) {
          const batch = ids.slice(idx, idx + m.addCount);
          try {
            await apiPost('/api/upsell/distribution', { companyIds: batch, assignToId: m.id });
            idx += m.addCount;
            completedMembers++;
          } catch (e) {
            alert(`${m.displayName} 배분 실패 (${completedMembers}/${sortedForExec.filter(x => x.addCount > 0).length}명 완료)\n${e instanceof Error ? e.message : '오류'}`);
            break;
          }
        }
      }
      if (completedMembers === sortedForExec.filter(x => x.addCount > 0).length) {
        alert(`${total}건 공정 배분 완료`);
      }
      setSelectedCompanies(new Set());
      setSelectedMembers(new Set());
      await Promise.all([loadCompanies(), loadMembers()]);
    } catch (e) { alert(e instanceof Error ? e.message : '분배 실패'); }
    finally { setDistributing(false); }
  };

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
    setSelectedCompanies(new Set());
  };

  const getProductInfo = (c: UpsellCompany) => c.upsellAssignments[0]?.product || null;
  const getAssignment = (c: UpsellCompany) => c.upsellAssignments[0] || null;
  const getAssignee = (c: UpsellCompany) => c.upsellAssignments[0]?.assignedTo || null;

  // 배분 취소 (실장만)
  const handleUnassign = async (assignmentId: number, companyName: string) => {
    if (!confirm(`"${companyName}" 배분을 취소하시겠습니까?\n상품 설정도 함께 삭제됩니다.`)) return;
    try {
      await apiDelete(`/api/upsell/distribution?id=${assignmentId}`);
      await Promise.all([loadCompanies(), loadMembers()]);
    } catch (e) {
      alert(e instanceof Error ? e.message : '배분 취소 실패');
    }
  };

  // 제외가망 토글
  const handleToggleExclude = async (assignmentId: number, currentExcluded: boolean) => {
    try {
      await apiPost('/api/upsell/exclude', { assignmentId, isExcluded: !currentExcluded });
      await loadCompanies();
    } catch (e) {
      alert(e instanceof Error ? e.message : '제외가망 처리 실패');
    }
  };

  // 핀(즐겨찾기) 토글
  const handleTogglePin = async (companyId: number) => {
    try {
      const result = await apiPost<{ pinned: boolean }>(`/api/companies/${companyId}/pin`, {});
      setCompanies(prev => {
        const updated = prev.map(c => c.id === companyId ? { ...c, _isPinned: result.pinned } : c);
        return updated.sort((a, b) => {
          if (a._isPinned && !b._isPinned) return -1;
          if (!a._isPinned && b._isPinned) return 1;
          return 0;
        });
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : '즐겨찾기 처리 실패');
    }
  };

  const canSeeAll = isDirector;

  // 사원은 항상 "내 업체"만
  const effectiveTab = canSeeAll ? viewTab : 'mine';

  // 새 배분 토스트 알림 (내 업체 탭에서 총 건수 증가 시)
  const prevTotalRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (prevTotalRef.current > 0 && total > prevTotalRef.current && effectiveTab === 'mine') {
      const diff = total - prevTotalRef.current;
      setToast(`새로운 업체 ${diff}건이 배분되었습니다`);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 4000);
    }
    prevTotalRef.current = total;
  }, [total, effectiveTab]);

  const switchTab = (t: ViewTab) => {
    setViewTab(t);
    setPage(1);
    setSearch('');
    setSearchInput('');
    setBranch('');
    setAssigned('');
    setExcluded('');
    setPaymentFilter('');
    setExpiringFilter('');
    setProductStatusFilter('');
    setSelectedCompanies(new Set());
    setShowDistPanel(false);
  };

  return (
    <div className="crm-page">
      {/* 토스트 알림 */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 200,
          background: '#7c3aed', color: '#fff', padding: '12px 20px', borderRadius: 8,
          fontSize: 14, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          animation: 'toastSlideIn 0.3s ease-out',
        }}>
          {toast}
        </div>
      )}
      <style>{`
        @keyframes toastSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>

      {/* 탭 */}
      {canSeeAll && (
        <div className="tab-bar" style={{ marginBottom: 16 }}>
          <button onClick={() => switchTab('mine')}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: effectiveTab === 'mine' ? 600 : 400,
              color: effectiveTab === 'mine' ? '#8b5cf6' : '#64748b', background: 'none', border: 'none',
              borderBottom: effectiveTab === 'mine' ? '2px solid #8b5cf6' : '2px solid transparent', cursor: 'pointer',
            }}>
            내 업체
          </button>
          <button onClick={() => switchTab('all')}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: effectiveTab === 'all' ? 600 : 400,
              color: effectiveTab === 'all' ? '#8b5cf6' : '#64748b', background: 'none', border: 'none',
              borderBottom: effectiveTab === 'all' ? '2px solid #8b5cf6' : '2px solid transparent', cursor: 'pointer',
            }}>
            전체 업체
          </button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>
          {effectiveTab === 'mine' ? '내 업체' : '전체 업체'}
        </h1>
        {isDirector && effectiveTab === 'all' && (
          <button onClick={() => setShowDistPanel(!showDistPanel)}
            style={{
              padding: '8px 16px', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: showDistPanel ? '#7c3aed' : '#8b5cf6', color: '#fff',
            }}>
            {showDistPanel ? '분배 패널 닫기' : `분배 모드 ${selectedCompanies.size > 0 ? `(${selectedCompanies.size}건)` : ''}`}
          </button>
        )}
      </div>

      <div className="flex-row">
        {/* 업체 테이블 영역 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 필터 바 */}
          <div className="filter-bar">
            <div style={{ display: 'flex', gap: 4 }}>
              <input placeholder="업체명/대표자/전화번호" value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 200 }} />
              <button onClick={handleSearch} style={{ padding: '7px 12px', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>검색</button>
            </div>
            <select value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1); }}
              style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
              <option value="">전체 지사</option>
              {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            {isDirector && effectiveTab === 'all' && (
              <select value={assigned} onChange={(e) => { setAssigned(e.target.value); setPage(1); }}
                style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
                <option value="">전체</option>
                <option value="assigned">분배완료</option>
                <option value="unassigned">미분배</option>
              </select>
            )}
            <select value={excluded} onChange={(e) => { setExcluded(e.target.value); setPage(1); }}
              style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
              <option value="">전체 가망</option>
              <option value="active">활성 가망</option>
              <option value="excluded">제외 가망</option>
            </select>
            <select value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }}
              style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
              <option value="">계약상태</option>
              <option value="unpaid">계약전</option>
              <option value="paid">계약완료</option>
              <option value="churned">해지완료</option>
            </select>
            <button onClick={() => { setExpiringFilter(expiringFilter ? '' : 'true'); setPage(1); }}
              style={{
                padding: '7px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500,
                background: expiringFilter ? '#fef2f2' : '#f1f5f9',
                border: expiringFilter ? '1px solid #fecaca' : '1px solid #d1d5db',
                color: expiringFilter ? '#dc2626' : '#64748b',
              }}>
              {expiringFilter ? '만료임박 \u2715' : '만료임박'}
            </button>
            <button onClick={() => { setProductStatusFilter(productStatusFilter ? '' : 'noProduct'); setPage(1); }}
              style={{
                padding: '7px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500,
                background: productStatusFilter ? '#fef3c7' : '#f1f5f9',
                border: productStatusFilter ? '1px solid #fde68a' : '1px solid #d1d5db',
                color: productStatusFilter ? '#a16207' : '#64748b',
              }}>
              {productStatusFilter ? '미설정 \u2715' : '미설정'}
            </button>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
            <span style={{ color: '#94a3b8' }}>~</span>
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
            <div style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b' }}>
              총 {total.toLocaleString()}건
              {selectedCompanies.size > 0 && <span style={{ color: '#8b5cf6', fontWeight: 600, marginLeft: 8 }}>선택 {selectedCompanies.size}건</span>}
            </div>
          </div>

          {/* 테이블 */}
          <div className="table-wrap">
            <table style={{ fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {isDirector && showDistPanel && (
                    <th style={{ padding: '10px 8px', width: 36 }}>
                      <input type="checkbox" onChange={selectAllOnPage}
                        checked={companies.length > 0 && companies.every((c) => selectedCompanies.has(c.id))} />
                    </th>
                  )}
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: 11.5, cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => { if (sortBy === 'paymentDate') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortBy('paymentDate'); setSortDir('desc'); } setPage(1); }}>
                    결제일 {sortBy === 'paymentDate' ? (sortDir === 'desc' ? '\u2193' : '\u2191') : ''}
                  </th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: 11.5 }}>카드사</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: 11.5, cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => { if (sortBy === 'paymentAmount') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortBy('paymentAmount'); setSortDir('desc'); } setPage(1); }}>
                    결제금액 {sortBy === 'paymentAmount' ? (sortDir === 'desc' ? '\u2193' : '\u2191') : ''}
                  </th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: 11.5 }}>결제상태</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: 11.5 }}>계약</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: 11.5 }}>지사</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: 11.5, cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => { if (sortBy === 'companyName') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortBy('companyName'); setSortDir('asc'); } setPage(1); }}>
                    업체명 {sortBy === 'companyName' ? (sortDir === 'desc' ? '\u2193' : '\u2191') : ''}
                  </th>
                  {['대표자', '영업담당', '배분담당', '담당간부', '영수증', '카카오맵', '카카오채널', '블로그스킨', '노출갯수', '제외'].map((h) => (
                    <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: 11.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={isDirector && showDistPanel ? 18 : 17} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>로딩중...</td></tr>
                ) : companies.length === 0 ? (
                  <tr><td colSpan={isDirector && showDistPanel ? 18 : 17} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>데이터가 없습니다.</td></tr>
                ) : companies.map((c) => {
                  const product = getProductInfo(c);
                  const assignment = getAssignment(c);
                  const assignee = getAssignee(c);
                  const isExcluded = assignment?.isExcluded || false;
                  const contractRange = product?.contractStart && product?.contractEnd
                    ? `${new Date(product.contractStart).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}~${new Date(product.contractEnd).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}`
                    : '-';
                  const isSelected = selectedCompanies.has(c.id);
                  const isMyAssignment = assignment && assignment.assignedTo.id === authUser?.userId;

                  return (
                    <tr key={c.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isSelected ? '#f5f3ff' : isExcluded ? '#fef2f2' : '',
                        cursor: 'pointer',
                        opacity: isExcluded ? 0.6 : 1,
                      }}
                      onClick={() => {
                        if (showDistPanel && isDirector) { toggleCompany(c.id); }
                        else { router.push(`/upsell/companies/${c.id}`); }
                      }}
                      onMouseEnter={(e) => { if (!isSelected && !isExcluded) e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = isExcluded ? '#fef2f2' : ''; }}>
                      {isDirector && showDistPanel && (
                        <td style={{ padding: '8px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleCompany(c.id)} />
                        </td>
                      )}
                      <td style={{ padding: '9px 8px' }}>
                        {new Date(c.paymentDate).toLocaleDateString('ko-KR')}
                      </td>
                      <td style={{ padding: '9px 8px', fontSize: 11, color: '#475569' }}>{c.cardCompany || '-'}</td>
                      <td style={{ padding: '9px 8px', fontSize: 11, fontWeight: 500 }}>
                        {c.paymentAmount ? `${c.paymentAmount.toLocaleString()}원` : '-'}
                      </td>
                      <td style={{ padding: '9px 8px' }}>
                        {product ? (() => {
                          const ps = product.paymentStatus;
                          const cfg = ps === 'paid' ? { label: '계약완료', bg: '#dcfce7', color: '#16a34a' }
                            : ps === 'churned' ? { label: '해지', bg: '#fecaca', color: '#dc2626' }
                            : { label: '계약전', bg: '#f1f5f9', color: '#94a3b8' };
                          return (
                            <span style={{ background: cfg.bg, color: cfg.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>
                              {cfg.label}{product.hasTaxInvoice ? ' · 세금' : ''}
                            </span>
                          );
                        })() : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td style={{ padding: '9px 8px', fontSize: 11 }}>
                        {product?.contractEnd ? (() => {
                          const end = new Date(product.contractEnd);
                          const today = new Date(); today.setHours(0,0,0,0); end.setHours(0,0,0,0);
                          const diff = Math.ceil((end.getTime() - today.getTime()) / (1000*60*60*24));
                          const range = contractRange;
                          if (diff < 0) return <span style={{ color: '#dc2626', fontWeight: 600 }}>{range} <span style={{ background: '#fecaca', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>만료</span></span>;
                          if (diff <= 7) return <span style={{ color: '#dc2626', fontWeight: 500 }}>{range} <span style={{ background: '#fecaca', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>D-{diff}</span></span>;
                          if (diff <= 30) return <span style={{ color: '#d97706' }}>{range} <span style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>D-{diff}</span></span>;
                          return <span style={{ color: '#64748b' }}>{range}</span>;
                        })() : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td style={{ padding: '9px 8px' }}>
                        <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 3, fontSize: 11 }}>{c.branch || c.registrant}</span>
                      </td>
                      <td style={{ padding: '9px 8px', fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button onClick={(e) => { e.stopPropagation(); handleTogglePin(c.id); }}
                            title={c._isPinned ? '즐겨찾기 해제' : '즐겨찾기'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1, color: c._isPinned ? '#f59e0b' : '#d1d5db' }}>
                            {c._isPinned ? '\u2605' : '\u2606'}
                          </button>
                          <Link href={`/upsell/companies/${c.id}`} style={{ color: isExcluded ? '#94a3b8' : '#0f172a', textDecoration: isExcluded ? 'line-through' : 'none' }} onClick={(e) => e.stopPropagation()}>
                            {c.companyName}
                          </Link>
                          {c._isDuplicate && (
                            <span style={{ background: '#fecaca', color: '#dc2626', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>중복</span>
                          )}
                          {isExcluded && (
                            <span style={{ background: '#fecaca', color: '#dc2626', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>제외</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '9px 8px' }}>{c.representative}</td>
                      <td style={{ padding: '9px 8px', color: '#64748b' }}>{c.staffName}</td>
                      <td style={{ padding: '9px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ color: assignee ? '#8b5cf6' : '#cbd5e1' }}>{assignee?.displayName || '-'}</span>
                          {assignment && isDirector && !showDistPanel && (
                            <button onClick={(e) => { e.stopPropagation(); handleUnassign(assignment.id, c.companyName); }}
                              title="배분 취소"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '9px 8px', color: '#64748b' }}>{c.managerName}</td>
                      <td style={{ padding: '9px 8px' }}>
                        {product && product.reviewType !== 'kakao_only' ? (
                          <span style={{ fontSize: 11, color: product.receiptReviewCount >= product.receiptReviewTarget && product.receiptReviewTarget > 0 ? '#22c55e' : '#374151' }}>
                            {product.receiptReviewCount}/{product.receiptReviewTarget}
                          </span>
                        ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td style={{ padding: '9px 8px' }}>
                        {product?.kakaoMapUrl ? (
                          <a href={product.kakaoMapUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                            style={{ color: '#2563eb', fontSize: 11, textDecoration: 'none' }}>
                            {product.kakaoMapName || '링크'}
                          </a>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '9px 8px' }}>
                        {product?.channelType === 'kakao_channel' ? (
                          product.channelDone
                            ? <span style={{ background: '#dcfce7', color: '#16a34a', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>완료</span>
                            : <span style={{ background: '#fef3c7', color: '#d97706', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>진행중</span>
                        ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td style={{ padding: '9px 8px' }}>
                        {product?.channelType === 'blog_skin' ? (
                          product.channelDone
                            ? <span style={{ background: '#dcfce7', color: '#16a34a', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>완료</span>
                            : <span style={{ background: '#fef3c7', color: '#d97706', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>진행중</span>
                        ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td style={{ padding: '9px 8px', textAlign: 'center', fontWeight: 600, color: (product?.exposureCount || 0) > 0 ? '#8b5cf6' : '#cbd5e1' }}>
                        {product?.exposureCount || 0}
                      </td>
                      <td style={{ padding: '9px 8px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        {assignment && (isMyAssignment || isDirector) ? (
                          <button onClick={() => handleToggleExclude(assignment.id, isExcluded)}
                            title={isExcluded ? '제외 해제' : '제외가망 설정'}
                            style={{
                              background: isExcluded ? '#fecaca' : '#f1f5f9', border: 'none', borderRadius: 4,
                              padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                              color: isExcluded ? '#dc2626' : '#94a3b8',
                            }}>
                            {isExcluded ? '제외됨' : '-'}
                          </button>
                        ) : <span style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 */}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>

        {/* 분배 패널 (실장 전용) */}
        {isDirector && showDistPanel && (
          <div className="dist-panel">
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, position: 'sticky', top: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#0f172a' }}>분배 현황</h3>
              {members.length > 0 && (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', marginBottom: 12, fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0', paddingBottom: 4, marginBottom: 4 }}>
                    <span>이름</span><span>누적</span>
                  </div>
                  {members.map(m => (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: m.role === 'upselling_director' ? '#8b5cf6' : '#475569' }}>
                      <span>{m.displayName} {ROLE_LABELS[m.role] ? `(${ROLE_LABELS[m.role]})` : ''}</span>
                      <span style={{ fontWeight: 600 }}>{m._count.assignedUpsell}건</span>
                    </div>
                  ))}
                </div>
              )}
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#0f172a' }}>분배 대상</h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, maxHeight: 300, overflowY: 'auto' }}>
                {members.map((m) => {
                  const isChecked = selectedMembers.has(m.id);
                  const isSingle = selectedMembers.size === 1 && selectedMembers.has(m.id);
                  return (
                    <label key={m.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                      border: isChecked ? '2px solid #8b5cf6' : '1px solid #e2e8f0',
                      borderRadius: 8, cursor: 'pointer', background: isChecked ? '#f5f3ff' : isSingle ? '#faf5ff' : '#fff',
                    }}>
                      <input type="checkbox" checked={isChecked}
                        onChange={() => {
                          const next = new Set(selectedMembers);
                          if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                          setSelectedMembers(next);
                        }}
                        style={{ accentColor: '#8b5cf6' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{m.displayName}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>
                          {ROLE_LABELS[m.role] || m.role} · {m._count.assignedUpsell}건
                        </div>
                      </div>
                    </label>
                  );
                })}
                {members.length === 0 && (
                  <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>팀원이 없습니다.</div>
                )}
              </div>

              {/* 배분 미리보기 */}
              {selectedCompanies.size > 0 && selectedMembers.size > 1 && (() => {
                const sel = members.filter(m => selectedMembers.has(m.id));
                const total = selectedCompanies.size;
                // 누적 균등 시뮬레이션
                const sim = sel.map(m => ({
                  id: m.id, displayName: m.displayName, role: m.role,
                  current: m._count.assignedUpsell, add: 0,
                }));
                for (let i = 0; i < total; i++) {
                  sim.sort((a, b) => {
                    const diff = (a.current + a.add) - (b.current + b.add);
                    if (diff !== 0) return diff;
                    if (a.role === 'upselling_director') return 1;
                    if (b.role === 'upselling_director') return -1;
                    return 0;
                  });
                  sim[0].add++;
                }
                sim.sort((a, b) => b.add - a.add);
                return (
                  <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '8px 12px', marginBottom: 10, fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>배분 미리보기 ({total}건)</div>
                    {sim.map(m => (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: m.role === 'upselling_director' ? '#8b5cf6' : '#475569' }}>
                        <span>{m.displayName}{m.role === 'upselling_director' ? ' (실장)' : ''}</span>
                        <span style={{ fontWeight: 600 }}>{m.add}건 <span style={{ fontWeight: 400, color: '#94a3b8' }}>({m.current}→{m.current + m.add})</span></span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <button onClick={handleDistribute} disabled={distributing || selectedCompanies.size === 0 || selectedMembers.size === 0}
                style={{
                  width: '100%', padding: '12px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  opacity: distributing || selectedCompanies.size === 0 || selectedMembers.size === 0 ? 0.5 : 1,
                }}>
                {distributing ? '분배 중...' : `${selectedCompanies.size}건 분배하기`}
              </button>

              {selectedCompanies.size > 0 && (
                <button onClick={() => setSelectedCompanies(new Set())}
                  style={{ width: '100%', marginTop: 8, padding: '8px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#64748b' }}>
                  선택 초기화
                </button>
              )}

              {/* 공정 배분 */}
              <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 16, paddingTop: 16 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>공정 배분</h4>
                <p style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.4 }}>날짜 선택 시 미배분 업체가 좌측에 표시됩니다. 체크 해제로 제외 후 배분하세요.</p>
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                  <input type="date" id="fairDistStart" style={{ flex: 1, padding: '5px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }} />
                  <span style={{ color: '#94a3b8', fontSize: 12, lineHeight: '28px' }}>~</span>
                  <input type="date" id="fairDistEnd" style={{ flex: 1, padding: '5px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }} />
                </div>
                <button
                  onClick={() => {
                    const s = (document.getElementById('fairDistStart') as HTMLInputElement).value;
                    const e = (document.getElementById('fairDistEnd') as HTMLInputElement).value;
                    if (!s || !e) { alert('결제일 기간을 선택하세요.'); return; }
                    // 기간+미배분 필터를 적용해서 좌측 목록에 반영
                    setStartDate(s);
                    setEndDate(e);
                    setAssigned('unassigned');
                    setPage(1);
                  }}
                  style={{ width: '100%', padding: '8px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#475569', fontWeight: 500, marginBottom: 8 }}>
                  미배분 업체 조회
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
