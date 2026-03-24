'use client';

import { useEffect, useState, useCallback } from 'react';
import Pagination from '@/components/Pagination';

interface User {
  id: number;
  username: string;
  displayName: string;
  role: string;
  branch: string;
  mgmtPosition: string | null;
  mgmtTeam: string | null;
  responsibilities: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  createdBy: { displayName: string } | null;
  _count: { assignedUpsell: number };
}

const ROLE_LABELS: Record<string, string> = {
  admin: '관리자',
  manager_team: '관리팀',
  manager: '간부',
  staff: '영업자',
  upselling_director: '업셀링 실장',
  upselling_chief: '업셀링 주임',
  upselling_staff: '업셀링 사원',
};

const MGMT_POSITIONS = [
  { value: 'director', label: '실장' },
  { value: 'deputy', label: '부실장' },
  { value: 'sp', label: 'SP' },
  { value: 'staff', label: '사원' },
];

const RESPONSIBILITY_OPTIONS = [
  { value: 'reward', label: '리워드' },
  { value: 'premium_video', label: '프리미엄영상' },
  { value: 'short_video', label: '일반숏폼' },
  { value: 'press', label: '기자단' },
  { value: 'insta', label: '인스타' },
  { value: 'seo', label: 'SEO' },
  { value: 'cs', label: 'CS' },
  { value: 'homepage', label: '홈페이지' },
];

const ROLE_OPTIONS = [
  { value: 'admin', label: '관리자' },
  { value: 'manager_team', label: '관리팀' },
  { value: 'branch_manager', label: '지사장' },
  { value: 'manager', label: '간부' },
  { value: 'staff', label: '영업자' },
  { value: 'upselling_director', label: '업셀링 실장' },
  { value: 'upselling_chief', label: '업셀링 주임' },
  { value: 'upselling_staff', label: '업셀링 사원' },
];

const BRANCH_OPTIONS = ['인천', '수원', '동탄', '용인', '부산', '본사'];

type TeamType = 'admin' | 'manager_team' | 'sales' | 'upsell';

interface FormData {
  displayName: string;
  username: string;
  password: string;
  team: TeamType;
  role: string;
  branch: string;
  mgmtTeam: string;
  mgmtPosition: string;
  responsibilities: string[];
}

const TEAM_ROLE_MAP: Record<TeamType, Array<{ value: string; label: string }>> = {
  admin: [
    { value: 'admin', label: '관리자' },
  ],
  manager_team: [
    { value: 'manager_team', label: '관리팀' },
  ],
  sales: [
    { value: 'branch_manager', label: '지사장' },
    { value: 'manager', label: '간부' },
    { value: 'staff', label: '영업자' },
  ],
  upsell: [
    { value: 'upselling_director', label: '실장' },
    { value: 'upselling_chief', label: '주임' },
    { value: 'upselling_staff', label: '사원' },
  ],
};

// 지사 고정 여부: admin, manager_team, upselling_* → 본사 고정
const FIXED_BRANCH_ROLES = ['admin', 'manager_team', 'upselling_director', 'upselling_chief', 'upselling_staff'];

function getTeamFromRole(role: string): TeamType {
  if (role === 'admin') return 'admin';
  if (role === 'manager_team') return 'manager_team';
  if (role.startsWith('upselling_')) return 'upsell';
  return 'sales';
}

function getRoleDisplay(user: User): string {
  if (user.role === 'manager_team') {
    const teamLabel = user.mgmtTeam ? `${user.mgmtTeam}팀` : '';
    const posLabel = MGMT_POSITIONS.find(p => p.value === user.mgmtPosition)?.label || '';
    const parts = ['관리팀', teamLabel, posLabel].filter(Boolean);
    return parts.join(' ');
  }
  return ROLE_LABELS[user.role] || user.role;
}

const emptyForm: FormData = {
  displayName: '',
  username: '',
  password: '',
  team: 'sales',
  role: 'staff',
  branch: '본사',
  mgmtTeam: '',
  mgmtPosition: '',
  responsibilities: [],
};

type TeamTab = 'all' | 'management' | 'sales' | 'upsell';

const MANAGEMENT_ROLES = ['admin', 'manager_team'];
const SALES_ROLES = ['branch_manager', 'manager', 'staff'];
const UPSELL_ROLE_VALUES = ['upselling_director', 'upselling_chief', 'upselling_staff'];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [teamTab, setTeamTab] = useState<TeamTab>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authRole, setAuthRole] = useState('');
  const pageSize = 50;

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Auth user role 가져오기
  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setAuthRole(d.user?.role || ''))
      .catch(() => {});
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      if (roleFilter) {
        params.set('role', roleFilter);
      } else if (teamTab === 'management') {
        params.set('roles', MANAGEMENT_ROLES.join(','));
      } else if (teamTab === 'sales') {
        params.set('roles', SALES_ROLES.join(','));
      } else if (teamTab === 'upsell') {
        params.set('roles', UPSELL_ROLE_VALUES.join(','));
      }
      const res = await fetch(`/api/users?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('계정 목록을 불러올 수 없습니다.');
      const json = await res.json();
      setUsers(json.users || []);
      setTotal(json.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, teamTab]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function openCreateModal() {
    setForm(emptyForm);
    setFormError('');
    setModalMode('create');
    setEditingUserId(null);
    setModalOpen(true);
  }

  function openEditModal(user: User) {
    setForm({
      displayName: user.displayName,
      username: user.username,
      password: '',
      team: getTeamFromRole(user.role),
      role: user.role,
      branch: user.branch || '본사',
      mgmtTeam: user.mgmtTeam || '',
      mgmtPosition: user.mgmtPosition || '',
      responsibilities: user.responsibilities ? user.responsibilities.split(',') : [],
    });
    setFormError('');
    setModalMode('edit');
    setEditingUserId(user.id);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingUserId(null);
    setFormError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    if (!form.displayName.trim()) {
      setFormError('이름을 입력해주세요.');
      return;
    }
    if (!form.username.trim()) {
      setFormError('아이디를 입력해주세요.');
      return;
    }
    if (modalMode === 'create' && !form.password) {
      setFormError('비밀번호를 입력해주세요.');
      return;
    }

    setFormLoading(true);
    try {
      const isCreate = modalMode === 'create';
      const method = isCreate ? 'POST' : 'PUT';

      const body: Record<string, unknown> = {
        displayName: form.displayName.trim(),
        username: form.username.trim(),
        role: form.role,
        branch: form.branch,
        mgmtTeam: form.role === 'manager_team' ? form.mgmtTeam : null,
        mgmtPosition: form.role === 'manager_team' ? form.mgmtPosition : null,
        responsibilities: form.role === 'manager_team' ? form.responsibilities.join(',') : null,
      };
      if (!isCreate) {
        body.id = editingUserId;
      }
      if (form.password) {
        body.password = form.password;
      }

      const res = await fetch('/api/users', {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || (isCreate ? '계정 생성에 실패했습니다.' : '수정에 실패했습니다.'));
      }

      closeModal();
      fetchUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/users?id=${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || '삭제에 실패했습니다.');
      }
      setDeleteTarget(null);
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleteLoading(false);
    }
  }

  function formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0f172a] tracking-tight">계정 관리</h1>
          <p className="text-[#64748b] text-sm mt-1">사용자 계정을 추가하거나 관리합니다.</p>
        </div>
        <button
          onClick={openCreateModal}
          className="h-9 px-4 text-[13px] font-medium text-white bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors duration-100 flex items-center gap-1.5 cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          계정 추가
        </button>
      </div>

      {/* 팀 탭 */}
      {(authRole === 'admin' || authRole === 'manager_team') && (
        <div className="tab-bar" style={{ marginBottom: 16 }}>
          {([
            { value: 'all' as const, label: '전체', color: '#0f172a' },
            { value: 'management' as const, label: '관리팀', color: '#f59e0b' },
            { value: 'sales' as const, label: '영업팀', color: '#2563eb' },
            { value: 'upsell' as const, label: '업셀링팀', color: '#8b5cf6' },
          ]).map((t) => (
            <button key={t.value} onClick={() => { setTeamTab(t.value); setRoleFilter(''); setPage(1); }}
              style={{ padding: '10px 20px', fontSize: 14, fontWeight: teamTab === t.value ? 600 : 400, color: teamTab === t.value ? t.color : '#64748b', background: 'none', border: 'none', borderBottom: teamTab === t.value ? `2px solid ${t.color}` : '2px solid transparent', cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* 검색 + 필터 */}
      <div className="filter-bar" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input placeholder="이름 / 아이디 검색" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1); } }}
            className="h-9 px-3 text-[13px] border border-[#d1d5db]"
            style={{ width: 200, minWidth: 0 }} />
          <button onClick={() => { setSearch(searchInput); setPage(1); }}
            className="h-9 px-3 text-[13px] bg-[#f1f5f9] border border-[#d1d5db] cursor-pointer">검색</button>
        </div>
        <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="h-9 px-3 text-[13px] border border-[#d1d5db]">
          <option value="">전체 역할</option>
          {ROLE_OPTIONS
            .filter((r) => {
              if (teamTab === 'management') return MANAGEMENT_ROLES.includes(r.value);
              if (teamTab === 'sales') return SALES_ROLES.includes(r.value);
              if (teamTab === 'upsell') return UPSELL_ROLE_VALUES.includes(r.value);
              return true;
            })
            .map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b' }}>총 {total}명</div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-[#fef2f2] border border-[#fecaca] px-4 py-3 text-[#dc2626] text-sm mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="table-wrap">
        <div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider">이름</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider">아이디</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider">역할</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider">지사</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider">생성자</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider">생성일</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider">마지막 접속</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-[#64748b] uppercase tracking-wider" style={{ minWidth: '120px', whiteSpace: 'nowrap' }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center">
                    <div className="flex items-center justify-center gap-2 text-[#94a3b8] text-sm">
                      <div className="w-4 h-4 border-2 border-[#e2e8f0] border-t-[#2563eb] rounded-full animate-spin" />
                      로딩중...
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-[#94a3b8] text-sm">
                    등록된 계정이 없습니다.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-[#f1f5f9] hover:bg-[#f8fafc] transition-colors duration-100"
                  >
                    <td className="px-5 py-3.5 text-[13.5px] font-medium text-[#0f172a]">
                      {user.displayName}
                    </td>
                    <td className="px-5 py-3.5 text-[13.5px] text-[#475569]">
                      {user.username}
                    </td>
                    <td className="px-5 py-3.5">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <RoleBadge role={user.role} label={getRoleDisplay(user)} />
                        {user.role === 'manager_team' && user.responsibilities && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {user.responsibilities.split(',').map((rv) => {
                              const opt = RESPONSIBILITY_OPTIONS.find((o) => o.value === rv);
                              return opt ? (
                                <span key={rv} style={{
                                  display: 'inline-block', padding: '1px 6px', fontSize: 11, fontWeight: 500,
                                  backgroundColor: '#f5f3ff', color: '#7c3aed', borderRadius: 4,
                                }}>
                                  {opt.label}
                                </span>
                              ) : null;
                            })}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-[13.5px] text-[#475569]">
                      {user.branch || '-'}
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-[#94a3b8]">
                      {user.createdBy?.displayName || '-'}
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-[#94a3b8]">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-[#64748b]">
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </td>
                    <td className="px-5 py-3.5" style={{ whiteSpace: 'nowrap' }}>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEditModal(user)}
                          className="h-7 px-3 text-[12px] font-medium text-[#2563eb] bg-[#eff6ff] border border-[#bfdbfe] hover:bg-[#dbeafe] transition-colors duration-100 cursor-pointer"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => setDeleteTarget(user)}
                          className="h-7 px-3 text-[12px] font-medium text-[#dc2626] bg-[#fef2f2] border border-[#fecaca] hover:bg-[#fee2e2] transition-colors duration-100 cursor-pointer"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="bg-white w-full max-w-[440px] mx-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e2e8f0]">
              <h3 className="text-[16px] font-semibold text-[#0f172a]">
                {modalMode === 'create' ? '계정 추가' : '계정 수정'}
              </h3>
              <button
                onClick={closeModal}
                className="w-8 h-8 flex items-center justify-center text-[#94a3b8] hover:text-[#475569] transition-colors duration-100 cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4.5 4.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#334155] mb-1.5">이름</label>
                  <input
                    type="text"
                    required
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    placeholder="표시 이름"
                    className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#334155] mb-1.5">아이디</label>
                  <input
                    type="text"
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="로그인 아이디"
                    className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#334155] mb-1.5">
                    비밀번호
                    {modalMode === 'edit' && (
                      <span className="text-[#94a3b8] font-normal ml-1">(변경 시에만 입력)</span>
                    )}
                  </label>
                  <input
                    type="password"
                    required={modalMode === 'create'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={modalMode === 'create' ? '비밀번호' : '변경하지 않으면 빈칸'}
                    className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
                  />
                </div>

                {/* 소속 선택 */}
                <div>
                  <label className="block text-[13px] font-medium text-[#334155] mb-1.5">소속</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {([
                      { value: 'admin' as const, label: '관리자', color: '#dc2626' },
                      { value: 'manager_team' as const, label: '관리팀', color: '#f59e0b' },
                      { value: 'sales' as const, label: '영업팀', color: '#2563eb' },
                      { value: 'upsell' as const, label: '업셀링팀', color: '#8b5cf6' },
                    ]).map((t) => (
                      <button key={t.value} type="button"
                        onClick={() => {
                          const defaultRole = TEAM_ROLE_MAP[t.value][0].value;
                          const fixedBranch = FIXED_BRANCH_ROLES.includes(defaultRole);
                          setForm({ ...form, team: t.value, role: defaultRole, branch: fixedBranch ? '본사' : form.branch });
                        }}
                        style={{
                          flex: 1, padding: '8px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          border: '2px solid', borderRadius: 6, transition: 'all 0.15s',
                          borderColor: form.team === t.value ? t.color : '#e2e8f0',
                          background: form.team === t.value ? `${t.color}10` : '#fff',
                          color: form.team === t.value ? t.color : '#64748b',
                        }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* 역할 (소속에 따라 옵션 변경) */}
                  <div>
                    <label className="block text-[13px] font-medium text-[#334155] mb-1.5">역할</label>
                    <select
                      value={form.role}
                      onChange={(e) => {
                        const newRole = e.target.value;
                        const fixedBranch = FIXED_BRANCH_ROLES.includes(newRole);
                        setForm({ ...form, role: newRole, branch: fixedBranch ? '본사' : form.branch });
                      }}
                      className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100 cursor-pointer"
                    >
                      {TEAM_ROLE_MAP[form.team].map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* 지사 (관리자/관리팀/업셀링 → 본사 고정) */}
                  <div>
                    <label className="block text-[13px] font-medium text-[#334155] mb-1.5">지사</label>
                    {FIXED_BRANCH_ROLES.includes(form.role) ? (
                      <div className="w-full h-10 px-3 flex items-center text-[13.5px] text-[#94a3b8] border border-[#e2e8f0] bg-[#f8fafc]">
                        본사 (고정)
                      </div>
                    ) : (
                      <select
                        value={form.branch}
                        onChange={(e) => setForm({ ...form, branch: e.target.value })}
                        className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100 cursor-pointer"
                      >
                        {BRANCH_OPTIONS.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* 관리팀 소속 팀 & 직급 & 담당 역할 */}
                {form.role === 'manager_team' && (
                  <>
                    <div>
                      <label className="block text-[13px] font-medium text-[#334155] mb-1.5">소속 팀</label>
                      {form.mgmtPosition === 'director' || form.mgmtPosition === 'deputy' || form.mgmtPosition === 'sp' ? (
                        <div className="w-full h-10 px-3 flex items-center text-[13.5px] text-[#64748b] border border-[#e2e8f0] bg-[#f8fafc]">
                          전체 (1팀+2팀)
                        </div>
                      ) : (
                        <select
                          value={form.mgmtTeam}
                          onChange={(e) => setForm({ ...form, mgmtTeam: e.target.value })}
                          className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100 cursor-pointer"
                        >
                          <option value="">선택</option>
                          <option value="1">1팀</option>
                          <option value="2">2팀</option>
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-[#334155] mb-1.5">관리팀 직급</label>
                      <select
                        value={form.mgmtPosition}
                        onChange={(e) => setForm({ ...form, mgmtPosition: e.target.value })}
                        className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100 cursor-pointer"
                      >
                        <option value="">선택</option>
                        {MGMT_POSITIONS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-[#334155] mb-1.5">담당 역할 (복수 선택)</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {RESPONSIBILITY_OPTIONS.map((r) => (
                          <label key={r.value} style={{
                            display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                            border: '1px solid', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                            borderColor: form.responsibilities.includes(r.value) ? '#8b5cf6' : '#e2e8f0',
                            background: form.responsibilities.includes(r.value) ? '#f5f3ff' : '#fff',
                            color: form.responsibilities.includes(r.value) ? '#7c3aed' : '#64748b',
                          }}>
                            <input
                              type="checkbox"
                              checked={form.responsibilities.includes(r.value)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...form.responsibilities, r.value]
                                  : form.responsibilities.filter((v) => v !== r.value);
                                setForm({ ...form, responsibilities: next });
                              }}
                              style={{ accentColor: '#8b5cf6' }}
                            />
                            {r.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Form error */}
              {formError && (
                <div className="mt-4 bg-[#fef2f2] border border-[#fecaca] px-3 py-2 text-[#dc2626] text-[13px]">
                  {formError}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-[#f1f5f9]">
                <button
                  type="button"
                  onClick={closeModal}
                  className="h-9 px-4 text-[13px] font-medium text-[#64748b] bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] transition-colors duration-100 cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="h-9 px-5 text-[13px] font-medium text-white bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 cursor-pointer"
                >
                  {formLoading ? '처리중...' : modalMode === 'create' ? '추가' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 페이지네이션 */}
      <Pagination page={page} totalPages={Math.ceil(total / pageSize)} onPageChange={setPage} />

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <div
            className="bg-white w-full max-w-[380px] mx-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 flex items-center justify-center bg-[#fef2f2] shrink-0">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 3.5v5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="10" cy="13.5" r="0.75" fill="#dc2626" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-[#0f172a] mb-1">계정 삭제</h4>
                  <p className="text-[13px] text-[#64748b] leading-5">
                    <span className="font-medium text-[#0f172a]">{deleteTarget.displayName}</span> ({deleteTarget.username}) 계정을 삭제하시겠습니까?
                    <br />이 작업은 되돌릴 수 없습니다.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-[#f1f5f9]">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="h-9 px-4 text-[13px] font-medium text-[#64748b] bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] transition-colors duration-100 cursor-pointer"
                >
                  취소
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteLoading}
                  className="h-9 px-4 text-[13px] font-medium text-white bg-[#dc2626] hover:bg-[#b91c1c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 cursor-pointer"
                >
                  {deleteLoading ? '삭제중...' : '삭제'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role, label: overrideLabel }: { role: string; label?: string }) {
  const map: Record<string, { label: string; bg: string; text: string }> = {
    admin: { label: '관리자', bg: '#fef2f2', text: '#dc2626' },
    manager_team: { label: '관리팀', bg: '#eff6ff', text: '#2563eb' },
    manager: { label: '간부', bg: '#f0fdf4', text: '#16a34a' },
    staff: { label: '영업자', bg: '#f8fafc', text: '#475569' },
    upselling_director: { label: '업셀링 실장', bg: '#f5f3ff', text: '#7c3aed' },
    upselling_chief: { label: '업셀링 주임', bg: '#e0f2fe', text: '#0284c7' },
    upselling_staff: { label: '업셀링 사원', bg: '#ecfdf5', text: '#059669' },
  };
  const style = map[role] || { label: role, bg: '#f1f5f9', text: '#64748b' };

  return (
    <span
      className="inline-block px-2 py-0.5 text-[12px] font-medium"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {overrideLabel || style.label}
    </span>
  );
}
