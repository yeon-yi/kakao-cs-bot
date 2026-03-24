'use client';

import { useEffect, useState, useCallback } from 'react';

interface LogEntry {
  id: number;
  createdAt: string;
  user: { displayName: string };
  company: { companyName: string };
  fieldName: string;
  oldValue: string;
  newValue: string;
}

interface LogsResponse {
  logs: LogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const FIELD_LABEL_MAP: Record<string, string> = {
  '계약시작일': '계약시작일',
  '계약종료일': '계약종료일',
  '홀딩': '홀딩',
  '리워드': '리워드',
  '블로그 목표': '블로그 목표',
  '인스타 목표': '인스타 목표',
  '홈페이지': '홈페이지',
  '영상타입': '영상타입',
  '최종 세팅일': '최종 세팅일',
  '리워드 완료': '리워드 완료',
  '블로그 수': '블로그 수',
  '인스타 수': '인스타 수',
  '홈페이지 완료': '홈페이지 완료',
  '영상 완료': '영상 완료',
};

// 기존 영어 값을 한글로 변환
const VALUE_DISPLAY_MAP: Record<string, string> = {
  'Y': 'O',
  'N': 'X',
  'true': 'O',
  'false': 'X',
  'none': '없음',
  'premium': '프리미엄',
  'short': '숏폼',
};

function formatLogValue(value: string | null): string {
  if (!value || value === '') return '-';
  return VALUE_DISPLAY_MAP[value] ?? value;
}

// 업셀 로그 타입
interface UpsellLogEntry {
  id: number;
  createdAt: string;
  action: string;
  details: string | null;
  user: { displayName: string; role: string };
}

const PAGE_SIZE = 50;

type TeamTab = 'sales' | 'management' | 'upsell';

export default function LogsPage() {
  const [teamTab, setTeamTab] = useState<TeamTab>('sales');
  const [authRole, setAuthRole] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [upsellLogs, setUpsellLogs] = useState<UpsellLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [companySearch, setCompanySearch] = useState('');

  // auth 확인 (업셀 탭 표시 여부)
  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const role = d.user?.role || '';
        setAuthRole(role);
        // 업셀 역할이면 기본 탭을 업셀로
        if (['upselling_director', 'upselling_chief', 'upselling_staff'].includes(role)) {
          setTeamTab('upsell');
        }
      })
      .catch(() => {});
  }, []);

  // Debounce refs
  const [appliedFilters, setAppliedFilters] = useState({
    startDate: '',
    endDate: '',
    userSearch: '',
    companySearch: '',
  });

  const fetchLogs = useCallback(
    async (pageNum: number) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          pageSize: String(PAGE_SIZE),
        });
        if (appliedFilters.startDate) params.set('startDate', appliedFilters.startDate);
        if (appliedFilters.endDate) params.set('endDate', appliedFilters.endDate);
        if (appliedFilters.userSearch) params.set('userName', appliedFilters.userSearch);
        if (appliedFilters.companySearch) params.set('companyName', appliedFilters.companySearch);

        const res = await fetch(`/api/logs?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('활동 내역을 불러올 수 없습니다.');
        const json: LogsResponse = await res.json();
        setLogs(json.logs);
        setTotal(json.total);
        setPage(json.page);
      } catch (err) {
        setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    },
    [appliedFilters]
  );

  // 업셀 로그 fetch
  const fetchUpsellLogs = useCallback(
    async (pageNum: number) => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          pageSize: String(PAGE_SIZE),
        });
        if (appliedFilters.startDate) params.set('startDate', appliedFilters.startDate);
        if (appliedFilters.endDate) params.set('endDate', appliedFilters.endDate);

        const res = await fetch(`/api/upsell/logs?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('업셀 활동 내역을 불러올 수 없습니다.');
        const json = await res.json();
        setUpsellLogs(json.logs);
        setTotal(json.total);
        setPage(json.page);
      } catch (err) {
        setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    },
    [appliedFilters]
  );

  // 관리팀 솔루션 일괄등록 이력
  const [bulkLogs, setBulkLogs] = useState<Array<{ id: number; type: string; totalCount: number; successCount: number; failCount: number; createdAt: string; rolledBack: boolean; user: { displayName: string } }>>([]);
  const fetchBulkLogs = useCallback(
    async (pageNum: number) => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams({ action: 'history', page: String(pageNum), pageSize: String(PAGE_SIZE) });
        const res = await fetch(`/api/solutions/bulk?${params}`, { credentials: 'include' });
        if (!res.ok) throw new Error('관리팀 이력을 불러올 수 없습니다.');
        const json = await res.json();
        setBulkLogs(json.logs || []);
        setTotal(json.total || 0);
        setPage(json.page || 1);
      } catch (err) { setError(err instanceof Error ? err.message : '오류'); }
      finally { setLoading(false); }
    }, []);

  useEffect(() => {
    if (teamTab === 'sales') fetchLogs(1);
    else if (teamTab === 'management') fetchBulkLogs(1);
    else fetchUpsellLogs(1);
  }, [fetchLogs, fetchUpsellLogs, fetchBulkLogs, teamTab]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleApplyFilters() {
    setAppliedFilters({
      startDate,
      endDate,
      userSearch,
      companySearch,
    });
  }

  function handleResetFilters() {
    setStartDate('');
    setEndDate('');
    setUserSearch('');
    setCompanySearch('');
    setAppliedFilters({ startDate: '', endDate: '', userSearch: '', companySearch: '' });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleApplyFilters();
  }

  function getFieldLabel(fieldName: string): string {
    return FIELD_LABEL_MAP[fieldName] || fieldName;
  }

  function formatDateTime(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${day} ${h}:${mi}`;
  }

  const goToPage = (p: number) => {
    if (teamTab === 'sales') fetchLogs(p);
    else if (teamTab === 'management') fetchBulkLogs(p);
    else fetchUpsellLogs(p);
  };

  function renderPagination() {
    if (totalPages <= 1) return null;

    const buttons: React.ReactNode[] = [];
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    buttons.push(
      <button
        key="prev"
        onClick={() => goToPage(page - 1)}
        disabled={page <= 1}
        className="px-3 py-1.5 text-[13px] border border-[#e2e8f0] bg-white text-[#475569] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f8fafc] transition-colors duration-100"
      >
        이전
      </button>
    );

    if (start > 1) {
      buttons.push(
        <button
          key={1}
          onClick={() => goToPage(1)}
          className="px-3 py-1.5 text-[13px] border border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f8fafc] transition-colors duration-100"
        >
          1
        </button>
      );
      if (start > 2) {
        buttons.push(
          <span key="dots1" className="px-2 py-1.5 text-[#94a3b8] text-[13px]">...</span>
        );
      }
    }

    for (let i = start; i <= end; i++) {
      buttons.push(
        <button
          key={i}
          onClick={() => goToPage(i)}
          className={`px-3 py-1.5 text-[13px] border transition-colors duration-100 ${
            i === page
              ? 'border-[#2563eb] bg-[#2563eb] text-white font-medium'
              : 'border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f8fafc]'
          }`}
        >
          {i}
        </button>
      );
    }

    if (end < totalPages) {
      if (end < totalPages - 1) {
        buttons.push(
          <span key="dots2" className="px-2 py-1.5 text-[#94a3b8] text-[13px]">...</span>
        );
      }
      buttons.push(
        <button
          key={totalPages}
          onClick={() => goToPage(totalPages)}
          className="px-3 py-1.5 text-[13px] border border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f8fafc] transition-colors duration-100"
        >
          {totalPages}
        </button>
      );
    }

    buttons.push(
      <button
        key="next"
        onClick={() => goToPage(page + 1)}
        disabled={page >= totalPages}
        className="px-3 py-1.5 text-[13px] border border-[#e2e8f0] bg-white text-[#475569] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#f8fafc] transition-colors duration-100"
      >
        다음
      </button>
    );

    return (
      <div className="flex items-center justify-between px-5 py-4 border-t border-[#e2e8f0]">
        <span className="text-[13px] text-[#94a3b8]">
          전체 {total.toLocaleString()}건 중 {((page - 1) * PAGE_SIZE + 1).toLocaleString()}-
          {Math.min(page * PAGE_SIZE, total).toLocaleString()}건
        </span>
        <div className="flex items-center gap-1">{buttons}</div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0f172a] tracking-tight">활동 내역</h1>
        <p className="text-[#64748b] text-sm mt-1">업체 정보 변경 이력을 조회합니다.</p>
      </div>

      {/* 팀 탭 */}
      {(authRole === 'admin' || authRole === 'manager_team') && (
        <div className="tab-bar" style={{ marginBottom: 16 }}>
          <button onClick={() => { setTeamTab('sales'); setPage(1); }}
            style={{ padding: '10px 20px', fontSize: 14, fontWeight: teamTab === 'sales' ? 600 : 400, color: teamTab === 'sales' ? '#2563eb' : '#64748b', background: 'none', border: 'none', borderBottom: teamTab === 'sales' ? '2px solid #2563eb' : '2px solid transparent', cursor: 'pointer' }}>
            영업팀
          </button>
          <button onClick={() => { setTeamTab('management'); setPage(1); }}
            style={{ padding: '10px 20px', fontSize: 14, fontWeight: teamTab === 'management' ? 600 : 400, color: teamTab === 'management' ? '#f59e0b' : '#64748b', background: 'none', border: 'none', borderBottom: teamTab === 'management' ? '2px solid #f59e0b' : '2px solid transparent', cursor: 'pointer' }}>
            관리팀
          </button>
          <button onClick={() => { setTeamTab('upsell'); setPage(1); }}
            style={{ padding: '10px 20px', fontSize: 14, fontWeight: teamTab === 'upsell' ? 600 : 400, color: teamTab === 'upsell' ? '#8b5cf6' : '#64748b', background: 'none', border: 'none', borderBottom: teamTab === 'upsell' ? '2px solid #8b5cf6' : '2px solid transparent', cursor: 'pointer' }}>
            업셀링팀
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white border border-[#e2e8f0] p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[12px] font-medium text-[#64748b] mb-1">시작일</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-9 px-3 text-[13px] text-[#0f172a] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#64748b] mb-1">종료일</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-9 px-3 text-[13px] text-[#0f172a] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#64748b] mb-1">담당자</label>
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="이름 검색"
              className="h-9 px-3 w-[140px] text-[13px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#64748b] mb-1">업체명</label>
            <input
              type="text"
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="업체명 검색"
              className="h-9 px-3 w-[160px] text-[13px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
            />
          </div>
          <button
            onClick={handleApplyFilters}
            className="h-9 px-4 text-[13px] font-medium text-white bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors duration-100 cursor-pointer"
          >
            검색
          </button>
          <button
            onClick={handleResetFilters}
            className="h-9 px-4 text-[13px] font-medium text-[#64748b] bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] transition-colors duration-100 cursor-pointer"
          >
            초기화
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-[#fef2f2] border border-[#fecaca] px-4 py-3 text-[#dc2626] text-sm mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      {teamTab === 'management' ? (
      <div className="bg-white border border-[#e2e8f0]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b]">일시</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b]">유형</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] text-center">성공</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] text-center">실패</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b]">등록자</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b]">상태</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-[#94a3b8]">로딩중...</td></tr>
              ) : bulkLogs.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-[#94a3b8]">등록 이력이 없습니다.</td></tr>
              ) : bulkLogs.map((log) => (
                <tr key={log.id} className="border-b border-[#f1f5f9] text-[13px]">
                  <td className="px-5 py-3 text-[#475569] whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                  <td className="px-5 py-3">
                    <span style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600, borderRadius: 4, background: '#f5f3ff', color: '#7c3aed' }}>
                      {log.type === 'all' ? '전체' : log.type === 'blog' ? '블로그' : log.type === 'insta' ? '인스타' : log.type === 'homepage' ? '홈페이지' : '영상'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center font-semibold" style={{ color: '#16a34a' }}>{log.successCount}</td>
                  <td className="px-5 py-3 text-center font-semibold" style={{ color: log.failCount > 0 ? '#dc2626' : '#cbd5e1' }}>{log.failCount}</td>
                  <td className="px-5 py-3 text-[#475569]">{log.user.displayName}</td>
                  <td className="px-5 py-3">
                    {log.rolledBack
                      ? <span style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600, borderRadius: 4, background: '#f1f5f9', color: '#94a3b8', textDecoration: 'line-through' }}>롤백됨</span>
                      : <span style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600, borderRadius: 4, background: '#f0fdf4', color: '#16a34a' }}>완료</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {renderPagination()}
      </div>
      ) : teamTab === 'upsell' ? (
      <div className="bg-white border border-[#e2e8f0]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">일시</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">담당자</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">활동</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">상세</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center"><div className="flex items-center justify-center gap-2 text-[#94a3b8] text-sm"><div className="w-4 h-4 border-2 border-[#e2e8f0] border-t-[#8b5cf6] rounded-full animate-spin" />로딩중...</div></td></tr>
              ) : upsellLogs.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-[#94a3b8] text-sm">업셀링 활동 내역이 없습니다.</td></tr>
              ) : upsellLogs.map((log) => (
                <tr key={log.id} className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] transition-colors duration-100">
                  <td className="px-5 py-3 text-[13px] text-[#94a3b8] whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                  <td className="px-5 py-3 text-[13px] text-[#475569] font-medium whitespace-nowrap">{log.user?.displayName || '-'}</td>
                  <td className="px-5 py-3 text-[13px] text-[#0f172a] font-medium whitespace-nowrap">{log.action}</td>
                  <td className="px-5 py-3 text-[13px] text-[#64748b] max-w-[400px] truncate">{log.details || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && renderPagination()}
      </div>
      ) : (
      <div className="bg-white border border-[#e2e8f0]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">일시</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">담당자</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">업체명</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">변경 항목</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">이전 값</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">변경 후</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center">
                    <div className="flex items-center justify-center gap-2 text-[#94a3b8] text-sm">
                      <div className="w-4 h-4 border-2 border-[#e2e8f0] border-t-[#2563eb] rounded-full animate-spin" />
                      로딩중...
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-[#94a3b8] text-sm">
                    활동 내역이 없습니다.
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
                    <td className="px-5 py-3 text-[13px] text-[#475569] font-medium whitespace-nowrap">
                      {log.user?.displayName || '-'}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#0f172a] font-medium whitespace-nowrap">
                      {log.company?.companyName || '-'}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#475569] whitespace-nowrap">
                      {getFieldLabel(log.fieldName)}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#94a3b8] max-w-[200px] truncate">
                      {formatLogValue(log.oldValue)}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#0f172a] max-w-[200px] truncate">
                      {formatLogValue(log.newValue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && renderPagination()}
      </div>
      )}
    </div>
  );
}
