'use client';

import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSSERefresh } from '@/lib/useSSE';
import type { CompanySetting, CompanyProgress, Company } from '@/types';

interface ApiResponse {
  companies: Company[];
  total: number;
  page: number;
  pageSize: number;
}

interface Filters {
  search: string;
  branch: string;
  managerName: string;
  staffName: string;
  holding: string;       // '' | 'true' | 'false'
  solutionStatus: string; // '' | 'none' | 'progress' | 'done'
  status: string;         // '' | 'active' | 'completed' | 'churned'
  startDate: string;
  endDate: string;
  noProgressThisMonth: string; // '' | 'true'
  paymentAmountMin: string;
  paymentAmountMax: string;
}

/* ────────────────────── Solution status helpers ────────────── */

type CellStatus = 'none' | 'not_applicable' | 'pending' | 'progress' | 'done';

function getRewardStatus(setting: CompanySetting | null, progress: CompanyProgress | null): CellStatus {
  if (!setting) return 'none';
  if (!setting.hasReward) return 'not_applicable';
  if (!progress) return 'pending';
  return progress.rewardDone ? 'done' : 'pending';
}

function getBlogStatus(setting: CompanySetting | null, progress: CompanyProgress | null): { status: CellStatus; current: number; target: number } {
  if (!setting) return { status: 'none', current: 0, target: 0 };
  if (!setting.blogTarget || setting.blogTarget <= 0) return { status: 'not_applicable', current: 0, target: 0 };
  const current = progress?.blogCount ?? 0;
  const target = setting.blogTarget;
  if (current >= target) return { status: 'done', current, target };
  if (current > 0) return { status: 'progress', current, target };
  return { status: 'pending', current, target };
}

function getInstaStatus(setting: CompanySetting | null, progress: CompanyProgress | null): { status: CellStatus; current: number; target: number } {
  if (!setting) return { status: 'none', current: 0, target: 0 };
  if (!setting.instaTarget || setting.instaTarget <= 0) return { status: 'not_applicable', current: 0, target: 0 };
  const current = progress?.instaCount ?? 0;
  const target = setting.instaTarget;
  if (current >= target) return { status: 'done', current, target };
  if (current > 0) return { status: 'progress', current, target };
  return { status: 'pending', current, target };
}

function getHomepageStatus(setting: CompanySetting | null, progress: CompanyProgress | null): CellStatus {
  if (!setting) return 'none';
  if (!setting.hasHomepage) return 'not_applicable';
  if (!progress) return 'pending';
  return progress.homepageDone ? 'done' : 'pending';
}

function getSeoStatus(setting: CompanySetting | null, progress: CompanyProgress | null): CellStatus {
  if (!setting) return 'none';
  if (!setting.hasSeo) return 'not_applicable';
  if (!progress) return 'pending';
  return progress.seoDone ? 'done' : 'pending';
}

function getVideoStatus(setting: CompanySetting | null, progress: CompanyProgress | null): { status: CellStatus; type: string | null } {
  if (!setting) return { status: 'none', type: null };
  if (!setting.videoType) return { status: 'not_applicable', type: null };
  if (!progress) return { status: 'pending', type: setting.videoType };
  return { status: progress.videoDone ? 'done' : 'pending', type: setting.videoType };
}

function getContractDday(setting: CompanySetting | null): { label: string; expired: boolean } | null {
  if (!setting?.contractEnd) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(setting.contractEnd);
  end.setHours(0, 0, 0, 0);
  const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: '만료', expired: true };
  return { label: `D-${diff}`, expired: false };
}

function formatVideoType(type: string | null): string {
  if (!type) return '';
  switch (type) {
    case 'premium': return '프리미엄';
    case 'short': return '숏폼';
    default: return type;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ────────────────────── Cell rendering styles ────────────── */

const CELL_STYLES: Record<CellStatus, { bg: string; text: string }> = {
  none:           { bg: '#f1f5f9', text: '#94a3b8' },
  not_applicable: { bg: '#f8fafc', text: '#cbd5e1' },
  pending:        { bg: '#fef2f2', text: '#dc2626' },
  progress:       { bg: '#fefce8', text: '#ca8a04' },
  done:           { bg: '#f0fdf4', text: '#16a34a' },
};

/* ────────────────────── Constants ────────────── */

const PAGE_SIZE = 50;

const BRANCH_OPTIONS = [
  '전체', '인천', '수원', '동탄', '용인', '부산', '본사',
];

const HOLDING_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'true', label: 'O' },
  { value: 'false', label: 'X' },
];

const SOLUTION_STATUS_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'notset', label: '미설정' },
  { value: 'inprogress', label: '진행중' },
  { value: 'completed', label: '완료' },
];

/* ════════════════════════════════════════════════════════════ */
/*                    CompaniesPage Component                  */
/* ════════════════════════════════════════════════════════════ */

export default function CompaniesPage() {
  const router = useRouter();

  /* ── State ── */
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isFilterOpen, setIsFilterOpen] = useState(true);

  // 정렬
  const [sortKey, setSortKey] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // 신규 업체 등록
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [authBranch, setAuthBranch] = useState('');
  const [createForm, setCreateForm] = useState({
    companyName: '', representative: '', phone: '', paymentDate: new Date().toISOString().slice(0, 10),
    staffName: '', managerName: '', cardCompany: '', paymentAmount: '',
  });

  // 커스텀 확인 모달
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    type: 'info' | 'warning' | 'danger';
    confirmLabel?: string;
    resolve?: (v: boolean) => void;
  }>({ open: false, title: '', message: '', type: 'info' });

  const showConfirm = (title: string, message: string, type: 'info' | 'warning' | 'danger' = 'info', confirmLabel?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmModal({ open: true, title, message, type, confirmLabel, resolve });
    });
  };

  const closeConfirm = (result: boolean) => {
    confirmModal.resolve?.(result);
    setConfirmModal({ open: false, title: '', message: '', type: 'info' });
  };

  // 토스트 메시지
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [filters, setFilters] = useState<Filters>({
    search: '',
    branch: '',
    managerName: '',
    staffName: '',
    holding: '',
    solutionStatus: '',
    status: '',
    startDate: '',
    endDate: '',
    noProgressThisMonth: '',
    paymentAmountMin: '',
    paymentAmountMax: '',
  });

  // Applied filters (only update on search click)
  const [appliedFilters, setAppliedFilters] = useState<Filters>({ ...filters });

  /* ── Data fetching ── */
  const fetchCompanies = useCallback(async (pageNum: number, f: Filters) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        pageSize: String(PAGE_SIZE),
      });
      if (f.search) params.set('search', f.search);
      if (f.branch) params.set('branch', f.branch);
      if (f.managerName) params.set('managerName', f.managerName);
      if (f.staffName) params.set('staffName', f.staffName);
      if (f.holding) params.set('holding', f.holding);
      if (f.solutionStatus) params.set('solutionStatus', f.solutionStatus);
      if (f.status) params.set('status', f.status);
      if (f.startDate) params.set('startDate', f.startDate);
      if (f.endDate) params.set('endDate', f.endDate);
      if (f.noProgressThisMonth) params.set('noProgressThisMonth', f.noProgressThisMonth);
      if (f.paymentAmountMin) params.set('paymentAmountMin', f.paymentAmountMin);
      if (f.paymentAmountMax) params.set('paymentAmountMax', f.paymentAmountMax);
      if (sortKey) { params.set('sortKey', sortKey); params.set('sortDir', sortDir); }

      const res = await fetch(`/api/companies?${params.toString()}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        throw new Error('Failed to fetch');
      }

      const data: ApiResponse = await res.json();
      setCompanies(data.companies);
      setTotal(data.total);
    } catch {
      setCompanies([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [router, sortKey, sortDir]);

  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' }).then(r => r.json()).then(d => setAuthBranch(d.user?.branch || '')).catch(() => {});
  }, []);

  useEffect(() => {
    fetchCompanies(page, appliedFilters);
  }, [page, appliedFilters, fetchCompanies]);

  // SSE 실시간 반영 — 깜빡임 방지: 신규건을 슬라이드 애니메이션으로 상단에 추가
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const knownIdsRef = useRef<Set<number>>(new Set());
  const highlightTimerRef = useRef<number | null>(null);

  // 현재 표시 중인 ID 추적
  useEffect(() => {
    const ids = new Set(companies.map(c => c.id));
    knownIdsRef.current = ids;
  }, [companies]);

  const mergeNewCompanies = useCallback(async () => {
    if (page !== 1) return; // 1페이지에서만 자동 추가
    try {
      const params = new URLSearchParams({ page: '1', pageSize: String(PAGE_SIZE) });
      if (appliedFilters.search) params.set('search', appliedFilters.search);
      if (appliedFilters.branch) params.set('branch', appliedFilters.branch);
      if (appliedFilters.managerName) params.set('managerName', appliedFilters.managerName);
      if (appliedFilters.staffName) params.set('staffName', appliedFilters.staffName);
      if (appliedFilters.holding) params.set('holding', appliedFilters.holding);
      if (appliedFilters.solutionStatus) params.set('solutionStatus', appliedFilters.solutionStatus);
      if (appliedFilters.status) params.set('status', appliedFilters.status);
      if (appliedFilters.startDate) params.set('startDate', appliedFilters.startDate);
      if (appliedFilters.endDate) params.set('endDate', appliedFilters.endDate);
      if (appliedFilters.noProgressThisMonth) params.set('noProgressThisMonth', appliedFilters.noProgressThisMonth);
      if (appliedFilters.paymentAmountMin) params.set('paymentAmountMin', appliedFilters.paymentAmountMin);
      if (appliedFilters.paymentAmountMax) params.set('paymentAmountMax', appliedFilters.paymentAmountMax);

      const res = await fetch(`/api/companies?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) return;
      const data: ApiResponse = await res.json();
      const freshCompanies = data.companies || [];

      // 새로 추가된 업체 찾기
      const addedIds = new Set<number>();
      for (const c of freshCompanies) {
        if (!knownIdsRef.current.has(c.id)) addedIds.add(c.id);
      }

      if (addedIds.size > 0 || data.total !== total) {
        setNewIds(addedIds);
        setCompanies(freshCompanies);
        setTotal(data.total);
        // 이전 타이머 정리 후 새 타이머
        if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = window.setTimeout(() => setNewIds(new Set()), 2000);
      }
    } catch { /* silent */ }
  }, [page, appliedFilters, total]);
  useSSERefresh(['company_updated'], mergeNewCompanies);

  // 하이라이트 타이머 cleanup
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // Escape key closes modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && showCreateModal) {
        setShowCreateModal(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCreateModal]);

  /* ── Filter handlers ── */
  function handleFilterChange(key: keyof Filters, value: string) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  function handleSearch(e?: FormEvent) {
    e?.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  }

  function handleSort(key: string) {
    if (sortKey === key) {
      if (sortDir === 'desc') setSortDir('asc');
      else { setSortKey(''); setSortDir('desc'); } // 3번째 클릭: 해제
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  }

  function handleReset() {
    const empty: Filters = {
      search: '',
      branch: '',
      managerName: '',
      staffName: '',
      holding: '',
      solutionStatus: '',
      status: '',
      startDate: '',
      endDate: '',
      noProgressThisMonth: '',
      paymentAmountMin: '',
      paymentAmountMax: '',
    };
    setFilters(empty);
    setPage(1);
    setAppliedFilters(empty);
  }

  /* ── Pagination ── */
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function getPaginationRange(): (number | 'ellipsis')[] {
    const range: (number | 'ellipsis')[] = [];
    const delta = 2;
    const left = Math.max(2, page - delta);
    const right = Math.min(totalPages - 1, page + delta);

    range.push(1);
    if (left > 2) range.push('ellipsis');
    for (let i = left; i <= right; i++) range.push(i);
    if (right < totalPages - 1) range.push('ellipsis');
    if (totalPages > 1) range.push(totalPages);

    return range;
  }

  /* ── Row click ── */
  function handleRowClick(id: number) {
    router.push(`/companies/${id}`);
  }

  /* ── 신규 업체 등록 ── */
  async function handleCreateCompany(e: FormEvent, force = false) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...createForm, force }),
      });
      const data = await res.json();
      if (res.status === 409 && data.duplicate) {
        // 중복 경고 → 확인 후 force 등록
        const ok = await showConfirm('중복 업체 확인', data.message, 'warning', '등록');
        if (ok) {
          await handleCreateCompany(e, true);
        }
        return;
      }
      if (!res.ok) { showToast(data.message || '등록 실패', 'error'); return; }
      showToast('업체가 등록되었습니다.');
      setShowCreateModal(false);
      setCreateForm({ companyName: '', representative: '', phone: '', paymentDate: new Date().toISOString().slice(0, 10), staffName: '', managerName: '', cardCompany: '', paymentAmount: '' });
      fetchCompanies(1, appliedFilters);
      setPage(1);
    } catch {
      showToast('업체 등록 중 오류가 발생했습니다.', 'error');
    } finally {
      setCreating(false);
    }
  }

  const CARD_COMPANIES = ['신한', '삼성', '현대', 'KB국민', '롯데', '하나', 'NH농협', 'BC', '우리', '씨티'];

  /* ════════════════════════ Render ════════════════════════ */

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* ── Top Bar ── */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 30,
        }}
      >
        <h1
          style={{
            fontSize: '18px',
            fontWeight: 700,
            color: '#0f172a',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          업체 관리
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#475569',
              backgroundColor: '#f1f5f9',
              padding: '4px 10px',
              borderRadius: '4px',
              letterSpacing: '0.02em',
            }}
          >
            총 {total.toLocaleString()}건
          </span>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            style={{
              height: '32px',
              padding: '0 14px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#7c3aed',
              backgroundColor: '#f5f3ff',
              border: '1px solid #ddd6fe',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            + 신규 업체 등록
          </button>
          <button
            type="button"
            onClick={() => { window.location.href = '/api/companies/export'; }}
            style={{
              height: '32px',
              padding: '0 14px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#16a34a',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7m0 0L4.5 6.5M7 9l2.5-2.5M2 11h10" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            엑셀 내보내기
          </button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        {/* Toggle */}
        <button
          type="button"
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 24px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#64748b',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            style={{
              transform: isFilterOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.15s',
            }}
          >
            <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          필터
          {(appliedFilters.search || appliedFilters.branch || appliedFilters.managerName || appliedFilters.staffName || appliedFilters.holding || appliedFilters.solutionStatus || appliedFilters.status || appliedFilters.startDate || appliedFilters.endDate || appliedFilters.noProgressThisMonth || appliedFilters.paymentAmountMin || appliedFilters.paymentAmountMax) && (
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#2563eb',
                display: 'inline-block',
              }}
            />
          )}
        </button>

        {isFilterOpen && (
          <form onSubmit={handleSearch} style={{ padding: '0 24px 16px 24px' }}>
            {/* Row 1 */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="업체명 / 대표자 / 번호"
                value={filters.search}
                onChange={e => handleFilterChange('search', e.target.value)}
                style={{
                  ...inputStyle,
                  width: '220px',
                  minWidth: '160px',
                }}
              />
              <select
                value={filters.branch}
                onChange={e => handleFilterChange('branch', e.target.value)}
                style={{
                  ...inputStyle,
                  width: '120px',
                  cursor: 'pointer',
                }}
              >
                {BRANCH_OPTIONS.map(b => (
                  <option key={b} value={b === '전체' ? '' : b}>
                    {b === '전체' ? '지사 전체' : b}
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={e => handleFilterChange('startDate', e.target.value)}
                  style={{ ...inputStyle, width: '140px' }}
                />
                <span style={{ color: '#94a3b8', fontSize: '12px' }}>~</span>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={e => handleFilterChange('endDate', e.target.value)}
                  style={{ ...inputStyle, width: '140px' }}
                />
              </div>
            </div>

            {/* Row 2 */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="담당자"
                value={filters.staffName}
                onChange={e => handleFilterChange('staffName', e.target.value)}
                style={{ ...inputStyle, width: '120px' }}
              />
              <input
                type="text"
                placeholder="간부"
                value={filters.managerName}
                onChange={e => handleFilterChange('managerName', e.target.value)}
                style={{ ...inputStyle, width: '120px' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>홀딩</span>
                <select
                  value={filters.holding}
                  onChange={e => handleFilterChange('holding', e.target.value)}
                  style={{ ...inputStyle, width: '72px', cursor: 'pointer' }}
                >
                  {HOLDING_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>솔루션</span>
                <select
                  value={filters.solutionStatus}
                  onChange={e => handleFilterChange('solutionStatus', e.target.value)}
                  style={{ ...inputStyle, width: '90px', cursor: 'pointer' }}
                >
                  {SOLUTION_STATUS_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                style={{ ...inputStyle, width: '100px', cursor: 'pointer' }}
              >
                <option value="">전체 상태</option>
                <option value="active">활성</option>
                <option value="completed">완료</option>
                <option value="churned">해지</option>
              </select>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>결제금액</span>
                <input
                  type="number"
                  placeholder="최소"
                  value={filters.paymentAmountMin}
                  onChange={e => handleFilterChange('paymentAmountMin', e.target.value)}
                  style={{ ...inputStyle, width: '90px' }}
                />
                <span style={{ color: '#94a3b8', fontSize: '12px' }}>~</span>
                <input
                  type="number"
                  placeholder="최대"
                  value={filters.paymentAmountMax}
                  onChange={e => handleFilterChange('paymentAmountMax', e.target.value)}
                  style={{ ...inputStyle, width: '90px' }}
                />
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={filters.noProgressThisMonth === 'true'}
                  onChange={e => handleFilterChange('noProgressThisMonth', e.target.checked ? 'true' : '')}
                  style={{ accentColor: '#dc2626' }}
                />
                이번달 미진행
              </label>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                <button
                  type="submit"
                  style={{
                    height: '32px',
                    padding: '0 16px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#ffffff',
                    backgroundColor: '#2563eb',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.backgroundColor = '#1d4ed8'; }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.backgroundColor = '#2563eb'; }}
                >
                  검색
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  style={{
                    height: '32px',
                    padding: '0 16px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: '#64748b',
                    backgroundColor: '#f1f5f9',
                    border: '1px solid #e2e8f0',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.backgroundColor = '#e2e8f0'; }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.backgroundColor = '#f1f5f9'; }}
                >
                  초기화
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* ── Table Container ── */}
      <div
        style={{
          margin: '0',
          backgroundColor: '#ffffff',
          overflowX: 'auto',
        }}
      >
        <table
          style={{
            width: '100%',
            minWidth: '1180px',
            borderCollapse: 'collapse',
            fontSize: '13px',
          }}
        >
          {/* Header */}
          <thead>
            <tr
              style={{
                backgroundColor: '#f8fafc',
                borderBottom: '2px solid #e2e8f0',
              }}
            >
              {TABLE_COLUMNS.map(col => {
                const sortable = ['paymentDate', 'paymentAmount', 'staffName'].includes(col.key);
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={sortable ? () => handleSort(col.key) : undefined}
                    onKeyDown={sortable ? (e) => { if (e.key === 'Enter') handleSort(col.key); } : undefined}
                    tabIndex={sortable ? 0 : undefined}
                    role={sortable ? 'button' : undefined}
                    style={{
                      padding: '10px 8px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: isSorted ? '#2563eb' : '#475569',
                      textAlign: col.align as 'left' | 'center',
                      whiteSpace: 'nowrap',
                      width: col.width,
                      letterSpacing: '0.01em',
                      borderBottom: '2px solid #e2e8f0',
                      backgroundColor: isSorted ? '#eff6ff' : '#f8fafc',
                      cursor: sortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      outline: 'none',
                    }}
                  >
                    {col.label}
                    {sortable && isSorted && (
                      <span style={{ marginLeft: '2px', fontSize: '10px' }}>
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                    {sortable && !isSorted && (
                      <span style={{ marginLeft: '2px', fontSize: '10px', color: '#cbd5e1' }}>⇅</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={TABLE_COLUMNS.length}
                  style={{
                    padding: '80px 0',
                    textAlign: 'center',
                    color: '#94a3b8',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" stroke="#e2e8f0" strokeWidth="2.5" />
                      <path d="M12 2a10 10 0 019.8 8" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                    데이터를 불러오는 중...
                  </div>
                </td>
              </tr>
            ) : companies.length === 0 ? (
              <tr>
                <td
                  colSpan={TABLE_COLUMNS.length}
                  style={{
                    padding: '80px 0',
                    textAlign: 'center',
                    color: '#94a3b8',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                      <rect x="4" y="8" width="28" height="22" rx="2" stroke="#cbd5e1" strokeWidth="1.5" fill="none" />
                      <line x1="4" y1="14" x2="32" y2="14" stroke="#cbd5e1" strokeWidth="1.5" />
                      <line x1="12" y1="8" x2="12" y2="30" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
                      <line x1="22" y1="8" x2="22" y2="30" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2" />
                    </svg>
                    <span>검색 결과가 없습니다.</span>
                  </div>
                </td>
              </tr>
            ) : (
              companies.map((company, idx) => (
                <CompanyRow
                  key={company.id}
                  company={company}
                  isEven={idx % 2 === 1}
                  isNew={newIds.has(company.id)}
                  onClick={() => handleRowClick(company.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {!isLoading && companies.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 24px 24px',
            backgroundColor: '#f8fafc',
          }}
        >
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            {PAGE_SIZE}건씩 보기
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            {/* Prev */}
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              style={{
                ...paginationBtnStyle,
                opacity: page <= 1 ? 0.4 : 1,
                cursor: page <= 1 ? 'default' : 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M8.5 3.5L5 7L8.5 10.5" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Page numbers */}
            {getPaginationRange().map((item, i) =>
              item === 'ellipsis' ? (
                <span
                  key={`ellipsis-${i}`}
                  style={{
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: '#94a3b8',
                  }}
                >
                  ...
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPage(item as number)}
                  style={{
                    ...paginationBtnStyle,
                    backgroundColor: page === item ? '#2563eb' : 'transparent',
                    color: page === item ? '#ffffff' : '#475569',
                    fontWeight: page === item ? 600 : 400,
                  }}
                >
                  {item}
                </button>
              )
            )}

            {/* Next */}
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              style={{
                ...paginationBtnStyle,
                opacity: page >= totalPages ? 0.4 : 1,
                cursor: page >= totalPages ? 'default' : 'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5.5 3.5L9 7L5.5 10.5" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {page} / {totalPages}
            </span>
            <input
              type="number"
              min={1}
              max={totalPages}
              placeholder="이동"
              style={{
                width: '56px',
                height: '28px',
                padding: '0 6px',
                fontSize: '12px',
                color: '#0f172a',
                border: '1px solid #e2e8f0',
                borderRadius: '4px',
                outline: 'none',
                textAlign: 'center',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseInt((e.target as HTMLInputElement).value);
                  if (val >= 1 && val <= totalPages) {
                    setPage(val);
                    (e.target as HTMLInputElement).value = '';
                  }
                }
              }}
            />
          </div>
        </div>
      )}

      {/* 신규 업체 등록 모달 */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowCreateModal(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 440, maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, color: '#0f172a' }}>신규 업체 등록</h2>
            <form onSubmit={handleCreateCompany} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'block', marginBottom: 4, fontWeight: 500, color: '#374151' }}>지사</span>
                <input value={authBranch || '자동 배정'} disabled
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, background: '#f8fafc', color: '#64748b', boxSizing: 'border-box' }} />
              </label>
              {[
                { key: 'companyName', label: '업체명', type: 'text' },
                { key: 'representative', label: '대표자', type: 'text' },
                { key: 'phone', label: '연락처', type: 'text' },
                { key: 'paymentDate', label: '결제일', type: 'date' },
                { key: 'staffName', label: '담당자', type: 'text' },
                { key: 'managerName', label: '간부', type: 'text' },
                { key: 'paymentAmount', label: '결제금액 (원)', type: 'number' },
              ].map(({ key, label, type }) => (
                <label key={key} style={{ fontSize: 13 }}>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 500, color: '#374151' }}>{label} <span style={{ color: '#ef4444' }}>*</span></span>
                  <input type={type} required value={createForm[key as keyof typeof createForm]}
                    onChange={(e) => setCreateForm({ ...createForm, [key]: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                </label>
              ))}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" onClick={() => setShowCreateModal(false)}
                  style={{ padding: '10px 20px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>취소</button>
                <button type="submit" disabled={creating}
                  style={{ padding: '10px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600, opacity: creating ? 0.5 : 1 }}>
                  {creating ? '등록 중...' : '등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 커스텀 확인 모달 */}
      {confirmModal.open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
            onClick={() => closeConfirm(false)} />
          <div style={{
            position: 'relative', width: '100%', maxWidth: '400px', margin: '0 16px',
            backgroundColor: '#fff', borderRadius: '12px', padding: '28px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
            animation: 'fadeInUp 0.2s ease-out',
          }}>
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '48px', height: '48px', borderRadius: '50%',
                backgroundColor: confirmModal.type === 'danger' ? '#fef2f2' : confirmModal.type === 'warning' ? '#fffbeb' : '#eff6ff',
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={confirmModal.type === 'danger' ? '#dc2626' : confirmModal.type === 'warning' ? '#d97706' : '#2563eb'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {confirmModal.type === 'danger' ? (
                    <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>
                  ) : (
                    <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                  )}
                </svg>
              </div>
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', textAlign: 'center', margin: '0 0 8px 0' }}>
              {confirmModal.title}
            </h3>
            <p style={{ fontSize: '14px', color: '#475569', textAlign: 'center', margin: '0 0 24px 0', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
              {confirmModal.message}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => closeConfirm(false)}
                style={{
                  flex: 1, height: '42px', fontSize: '14px', fontWeight: 600,
                  color: '#475569', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
                  borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                취소
              </button>
              <button onClick={() => closeConfirm(true)}
                style={{
                  flex: 1, height: '42px', fontSize: '14px', fontWeight: 600,
                  color: '#fff',
                  backgroundColor: confirmModal.type === 'danger' ? '#dc2626' : '#2563eb',
                  border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {confirmModal.confirmLabel || '확인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 메시지 */}
      {toast && (
        <div style={{
          position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
          padding: '12px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: 500,
          color: '#fff',
          backgroundColor: toast.type === 'error' ? '#dc2626' : '#16a34a',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          animation: 'fadeInUp 0.2s ease-out',
        }}>
          {toast.message}
        </div>
      )}

      {/* Spin animation keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*                     CompanyRow Component                     */
/* ════════════════════════════════════════════════════════════ */

function CompanyRow({
  company,
  isEven,
  isNew,
  onClick,
}: {
  company: Company;
  isEven: boolean;
  isNew?: boolean;
  onClick: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const { setting, progress } = company;

  const blogInfo = getBlogStatus(setting, progress);
  const instaInfo = getInstaStatus(setting, progress);
  const homepageStatus = getHomepageStatus(setting, progress);
  const seoStatus = getSeoStatus(setting, progress);
  const videoInfo = getVideoStatus(setting, progress);
  const contract = getContractDday(setting);

  // Risk highlighting
  const daysLeft = contract && !contract.expired ? parseInt(contract.label.replace('D-', '')) : NaN;
  const isExpiringSoon = contract && !contract.expired && !isNaN(daysLeft) && daysLeft <= 7;
  const isExpired = contract?.expired;
  const isHolding = setting?.isHolding;
  const noSetting = !setting;

  let rowBg: string;
  let borderLeft = '';
  if (isHovered || isFocused) {
    rowBg = '#f0f7ff';
  } else if (isExpired) {
    rowBg = '#fef2f2';
    borderLeft = '3px solid #dc2626';
  } else if (isExpiringSoon) {
    rowBg = '#fffbeb';
    borderLeft = '3px solid #f59e0b';
  } else if (isHolding) {
    rowBg = '#fffbeb';
    borderLeft = '3px solid #d97706';
  } else if (noSetting) {
    rowBg = isEven ? '#f8fafc' : '#ffffff';
  } else {
    rowBg = isEven ? '#fafafa' : '#ffffff';
  }

  return (
    <tr
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      tabIndex={0}
      role="link"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        backgroundColor: isNew ? '#eff6ff' : rowBg,
        borderBottom: '1px solid #f1f5f9',
        borderLeft: isNew ? '3px solid #2563eb' : borderLeft || undefined,
        cursor: 'pointer',
        transition: 'background-color 0.5s, opacity 0.5s',
        height: '40px',
        outline: 'none',
        opacity: company.status === 'churned' ? 0.5 : 1,
        animation: isNew ? 'slideIn 0.4s ease-out' : undefined,
      }}
    >
      {/* 결제일 */}
      <td style={{ ...tdBase, textAlign: 'center', color: '#64748b' }}>
        {formatDateShort(company.paymentDate)}
      </td>

      {/* 결제금액 */}
      <td style={{ ...tdBase, textAlign: 'right', color: '#374151', fontSize: '12px' }}>
        {company.paymentAmount ? `${company.paymentAmount.toLocaleString()}원` : '—'}
      </td>

      {/* 계약 */}
      <td style={{ ...tdBase, textAlign: 'center' }}>
        {contract ? (() => {
          const d = parseInt(contract.label.replace('D-', ''));
          const isRed = contract.expired || (!isNaN(d) && d <= 7);
          const isAmber = !contract.expired && !isNaN(d) && d > 7 && d <= 30;
          return (
            <span
              style={{
                display: 'inline-block',
                fontSize: '11px',
                fontWeight: 600,
                color: isRed ? '#dc2626' : isAmber ? '#b45309' : '#475569',
                backgroundColor: isRed ? '#fef2f2' : isAmber ? '#fffbeb' : 'transparent',
                border: isRed ? '1px solid #fecaca' : isAmber ? '1px solid #fde68a' : 'none',
                padding: '1px 6px',
                borderRadius: '3px',
                letterSpacing: '0.01em',
              }}
            >
              {contract.label}
            </span>
          );
        })() : (
          <span style={{ color: '#cbd5e1' }}>&mdash;</span>
        )}
      </td>

      {/* 진행 스텝 */}
      <td style={{ ...tdBase, textAlign: 'center' }}>
        {(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const step = (company as any)._step as number | undefined;
          if (!step || step <= 1) return <span style={{ fontSize: '10px', fontWeight: 600, color: '#dc2626', backgroundColor: '#fef2f2', border: '1px solid #fecaca', padding: '1px 5px', borderRadius: '3px' }}>미설정</span>;
          if (step === 2) return <span style={{ fontSize: '10px', fontWeight: 600, color: '#b45309', backgroundColor: '#fffbeb', border: '1px solid #fde68a', padding: '1px 5px', borderRadius: '3px' }}>S2</span>;
          if (step === 3) return <span style={{ fontSize: '10px', fontWeight: 600, color: '#2563eb', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', padding: '1px 5px', borderRadius: '3px' }}>S3</span>;
          return <span style={{ fontSize: '10px', fontWeight: 600, color: '#16a34a', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1px 5px', borderRadius: '3px' }}>진행</span>;
        })()}
      </td>

      {/* 지사 */}
      <td style={{ ...tdBase, textAlign: 'center', fontSize: '12px' }}>
        {company.branch ? (
          <span style={{
            padding: '1px 8px',
            borderRadius: '3px',
            fontWeight: 600,
            fontSize: '11px',
            ...({
              '본사': { color: '#1d4ed8', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' },
              '인천': { color: '#7c3aed', backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe' },
              '수원': { color: '#059669', backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0' },
              '동탄': { color: '#d97706', backgroundColor: '#fffbeb', border: '1px solid #fde68a' },
              '용인': { color: '#dc2626', backgroundColor: '#fef2f2', border: '1px solid #fecaca' },
              '부산': { color: '#0891b2', backgroundColor: '#ecfeff', border: '1px solid #a5f3fc' },
              '안산': { color: '#be185d', backgroundColor: '#fdf2f8', border: '1px solid #fbcfe8' },
            }[company.branch] || { color: '#64748b', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }),
          }}>
            {company.branch}
          </span>
        ) : <span style={{ color: '#cbd5e1' }}>&mdash;</span>}
      </td>

      {/* 업체명 */}
      <td
        style={{
          ...tdBase,
          fontWeight: 600,
          color: '#0f172a',
          maxWidth: '140px',
        }}
      >
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {company.companyName}
        </div>
        <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
          {(company._count?.memos ?? 0) > 0 && (
            <span
              title={`메모 ${company._count!.memos}건`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: '#ede9fe',
                color: '#7c3aed',
                fontSize: 9,
                fontWeight: 700,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {company._count!.memos}
            </span>
          )}
          {company._isDuplicate && <span style={{ background: '#fecaca', color: '#dc2626', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>중복</span>}
          {company.status === 'churned' && <span style={{ background: '#fecaca', color: '#dc2626', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>해지</span>}
        </div>
      </td>

      {/* 대표자 */}
      <td style={{ ...tdBase, color: '#334155' }}>
        {company.representative}
      </td>

      {/* 담당자 */}
      <td style={{ ...tdBase, color: '#475569' }}>
        {company.staffName}
      </td>

      {/* 간부 */}
      <td style={{ ...tdBase, color: '#475569' }}>
        {company.managerName}
      </td>

      {/* 리포트 */}
      <td style={{ ...tdBase, cursor: company._reportDone && company.placeId ? 'pointer' : undefined }}
        onClick={company._reportDone && company.placeId ? (e) => {
          e.stopPropagation();
          // 리포트 URL을 API에서 가져와 바로 이동
          fetch(`/api/homejeonsan?action=report_stats&placeNumber=${encodeURIComponent(company.placeId!)}`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(d => {
              if (d?.reportUrl) {
                if (d.placeName && d.placeName !== company.companyName && !company.companyName.includes(d.placeName) && !d.placeName.includes(company.companyName)) {
                  console.warn(`[리포트 불일치] CRM: ${company.companyName}, 모집플: ${d.placeName}, placeId: ${company.placeId}`);
                }
                window.open(d.reportUrl, '_blank');
              } else {
                window.open(`/companies/${company.id}`, '_blank');
              }
            })
            .catch(() => window.open(`/companies/${company.id}`, '_blank'));
        } : undefined}
        title={company._reportDone ? '클릭하여 리포트 바로가기' : undefined}
      >
        <SolutionCell status={company._reportDone ? 'done' : setting ? 'pending' : 'none'}>
          {company._reportDone ? <><CheckIcon /><span style={{ fontSize: '9px', marginLeft: '2px' }}>보기</span></> : setting ? 'X' : null}
        </SolutionCell>
      </td>

      {/* 블로그 */}
      <td style={tdBase}>
        <ProgressCell status={blogInfo.status} current={blogInfo.current} target={blogInfo.target}
          lastDate={blogInfo.current > 0 && progress?.blogLastAt ? formatDateShort(progress.blogLastAt as string) : undefined} />
      </td>

      {/* 인스타 */}
      <td style={tdBase}>
        <ProgressCell status={instaInfo.status} current={instaInfo.current} target={instaInfo.target}
          lastDate={instaInfo.current > 0 && progress?.instaLastAt ? formatDateShort(progress.instaLastAt as string) : undefined} />
      </td>

      {/* 홈페이지 */}
      <td style={tdBase}>
        <SolutionCell status={homepageStatus} lastDate={homepageStatus === 'done' && progress?.homepageLastAt ? formatDateShort(progress.homepageLastAt as string) : undefined}>
          {homepageStatus === 'done' ? <CheckIcon /> : homepageStatus === 'pending' ? 'X' : null}
        </SolutionCell>
      </td>

      {/* SEO */}
      <td style={tdBase}>
        <SolutionCell status={seoStatus} lastDate={seoStatus === 'done' && progress?.seoLastAt ? formatDateShort(progress.seoLastAt as string) : undefined}>
          {seoStatus === 'done' ? <CheckIcon /> : seoStatus === 'pending' ? 'X' : null}
        </SolutionCell>
      </td>

      {/* 영상 */}
      <td style={tdBase}>
        <VideoCell status={videoInfo.status} type={videoInfo.type}
          lastDate={videoInfo.status === 'done' && progress?.videoLastAt ? formatDateShort(progress.videoLastAt as string) : undefined} />
      </td>

      {/* 홀딩 */}
      <td style={{ ...tdBase, textAlign: 'center' }}>
        {setting?.isHolding ? (
          <span
            style={{
              display: 'inline-block',
              fontSize: '11px',
              fontWeight: 600,
              color: '#dc2626',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              padding: '1px 6px',
              borderRadius: '3px',
              letterSpacing: '0.02em',
            }}
          >
            홀딩
          </span>
        ) : (
          <span style={{ color: '#cbd5e1' }}>&mdash;</span>
        )}
      </td>

    </tr>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*                   Cell Sub-Components                       */
/* ════════════════════════════════════════════════════════════ */

function SolutionCell({
  status,
  children,
  lastDate,
}: {
  status: CellStatus;
  children?: React.ReactNode;
  lastDate?: string;
}) {
  const style = CELL_STYLES[status];
  const isInactive = status === 'none' || status === 'not_applicable';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '26px',
        borderRadius: '3px',
        backgroundColor: style.bg,
        color: style.text,
        fontSize: '12px',
        fontWeight: isInactive ? 400 : 600,
        margin: '0 4px',
        gap: '1px',
      }}
    >
      {isInactive ? <span>&mdash;</span> : children}
      {lastDate && <span style={{ fontSize: '9px', fontWeight: 400, color: '#94a3b8', lineHeight: 1 }}>{lastDate}</span>}
    </div>
  );
}

function ProgressCell({
  status,
  current,
  target,
  lastDate,
}: {
  status: CellStatus;
  current: number;
  target: number;
  lastDate?: string;
}) {
  const style = CELL_STYLES[status];
  const isInactive = status === 'none' || status === 'not_applicable';
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '32px',
        borderRadius: '3px',
        backgroundColor: style.bg,
        color: style.text,
        fontSize: '11.5px',
        fontWeight: isInactive ? 400 : 600,
        margin: '0 4px',
        padding: '2px 4px',
        gap: '1px',
      }}
    >
      {isInactive ? (
        <span>&mdash;</span>
      ) : (
        <>
          <span style={{ lineHeight: 1 }}>
            {status === 'done' ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <CheckIcon />
                <span>{current}/{target}</span>
              </span>
            ) : (
              `${current}/${target}`
            )}
          </span>
          {/* Mini progress bar */}
          <div
            style={{
              width: '100%',
              maxWidth: '56px',
              height: '3px',
              backgroundColor: status === 'done' ? '#bbf7d0' : status === 'progress' ? '#fef08a' : '#fecaca',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                backgroundColor: status === 'done' ? '#16a34a' : status === 'progress' ? '#ca8a04' : '#dc2626',
                borderRadius: '2px',
                transition: 'width 0.3s',
              }}
            />
          </div>
          {lastDate && (
            <span style={{ fontSize: '9px', fontWeight: 400, color: '#94a3b8', lineHeight: 1 }}>
              {lastDate}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function VideoCell({
  status,
  type,
  lastDate,
}: {
  status: CellStatus;
  type: string | null;
  lastDate?: string;
}) {
  const style = CELL_STYLES[status];
  const isInactive = status === 'none' || status === 'not_applicable';
  const typeLabel = formatVideoType(type);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '32px',
        borderRadius: '3px',
        backgroundColor: style.bg,
        color: style.text,
        fontSize: '11.5px',
        fontWeight: isInactive ? 400 : 600,
        margin: '0 4px',
        padding: '2px 4px',
        gap: '1px',
        lineHeight: 1.2,
      }}
    >
      {isInactive ? (
        <span>&mdash;</span>
      ) : (
        <>
          {typeLabel && (
            <span style={{ fontSize: '10px', fontWeight: 400, opacity: 0.8 }}>
              {typeLabel}
            </span>
          )}
          <span>
            {status === 'done' ? <CheckIcon /> : 'X'}
          </span>
          {lastDate && <span style={{ fontSize: '9px', fontWeight: 400, color: '#94a3b8', lineHeight: 1 }}>{lastDate}</span>}
        </>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*                     Column Definitions                      */
/* ════════════════════════════════════════════════════════════ */

const TABLE_COLUMNS = [
  { key: 'paymentDate', label: '결제일', width: '64px', align: 'center' },
  { key: 'paymentAmount', label: '결제금액', width: '80px', align: 'right' },
  { key: 'contract', label: '계약', width: '64px', align: 'center' },
  { key: 'step', label: '진행', width: '48px', align: 'center' },
  { key: 'branch', label: '지사', width: '52px', align: 'center' },
  { key: 'companyName', label: '업체명', width: '120px', align: 'left' },
  { key: 'representative', label: '대표자', width: '68px', align: 'left' },
  { key: 'staffName', label: '담당자', width: '64px', align: 'left' },
  { key: 'managerName', label: '간부', width: '64px', align: 'left' },
  { key: 'report', label: '리포트', width: '48px', align: 'center' },
  { key: 'blog', label: '블로그', width: '64px', align: 'center' },
  { key: 'insta', label: '인스타', width: '64px', align: 'center' },
  { key: 'homepage', label: '홈페이지', width: '60px', align: 'center' },
  { key: 'seo', label: 'SEO', width: '48px', align: 'center' },
  { key: 'video', label: '영상', width: '60px', align: 'center' },
  { key: 'holding', label: '홀딩', width: '48px', align: 'center' },
];

/* ════════════════════════════════════════════════════════════ */
/*                    Shared Inline Styles                      */
/* ════════════════════════════════════════════════════════════ */

const inputStyle: React.CSSProperties = {
  height: '32px',
  padding: '0 10px',
  fontSize: '12px',
  color: '#0f172a',
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '4px',
  outline: 'none',
  transition: 'border-color 0.15s',
};

const tdBase: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: '13px',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
};

const paginationBtnStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '12px',
  color: '#475569',
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};
