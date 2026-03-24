'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiDelete } from '@/lib/api-client';
import { BRANCHES } from '@/lib/constants';

interface DistMember {
  id: number;
  displayName: string;
  role: string;
  _count: { assignedUpsell: number };
}

interface Company {
  id: number;
  companyName: string;
  representative: string;
  branch: string | null;
  paymentDate: string;
  upsellAssignments: { id: number; assignedTo: { displayName: string } }[];
}

const ROLE_LABELS: Record<string, string> = { upselling_chief: '주임', upselling_staff: '사원' };

export default function UpsellDistributionPage() {
  const [members, setMembers] = useState<DistMember[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyTotal, setCompanyTotal] = useState(0);
  const [selectedCompanies, setSelectedCompanies] = useState<Set<number>>(new Set());
  const [selectedMember, setSelectedMember] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [distributing, setDistributing] = useState(false);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('unassigned');
  const [page, setPage] = useState(1);
  const [unassignedCount, setUnassignedCount] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '50', assigned: filterAssigned });
      if (search) params.set('search', search);
      if (branch) params.set('branch', branch);

      const [distData, compData] = await Promise.all([
        apiGet<{ members: DistMember[]; unassignedCount: number }>('/api/upsell/distribution'),
        apiGet<{ companies: Company[]; total: number }>(`/api/upsell/companies?${params}`),
      ]);

      setMembers(distData.members);
      setUnassignedCount(distData.unassignedCount);
      setCompanies(compData.companies);
      setCompanyTotal(compData.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, branch, filterAssigned]);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleCompany = (id: number) => {
    setSelectedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const allIds = companies.map((c) => c.id);
    setSelectedCompanies((prev) => {
      const allSelected = allIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        allIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...allIds]);
    });
  };

  const handleDistribute = async () => {
    if (selectedCompanies.size === 0) { alert('분배할 업체를 선택하세요.'); return; }
    if (!selectedMember) { alert('분배 대상 팀원을 선택하세요.'); return; }

    const memberName = members.find((m) => m.id === selectedMember)?.displayName;
    if (!confirm(`선택한 ${selectedCompanies.size}건을 ${memberName}에게 분배하시겠습니까?`)) return;

    setDistributing(true);
    try {
      const result = await apiPost<{ message: string; count: number }>('/api/upsell/distribution', {
        companyIds: Array.from(selectedCompanies),
        assignToId: selectedMember,
      });
      alert(result.message);
      setSelectedCompanies(new Set());
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : '분배 실패');
    } finally {
      setDistributing(false);
    }
  };

  const totalPages = Math.ceil(companyTotal / 50);

  return (
    <div style={{ padding: '24px 32px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>업체 분배</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
        {/* 좌측: 업체 목록 */}
        <div>
          {/* 필터 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="업체명 검색" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 180 }} />
            <select value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1); }}
              style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
              <option value="">전체 지사</option>
              {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={filterAssigned} onChange={(e) => { setFilterAssigned(e.target.value); setPage(1); }}
              style={{ padding: '7px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
              <option value="">전체</option>
              <option value="unassigned">미분배</option>
              <option value="assigned">분배완료</option>
            </select>
            <div style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b' }}>
              미분배 {unassignedCount}건 | 선택 <strong style={{ color: '#8b5cf6' }}>{selectedCompanies.size}</strong>건
            </div>
          </div>

          {/* 업체 테이블 */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '10px 8px', width: 36 }}>
                    <input type="checkbox" onChange={selectAll} checked={companies.length > 0 && companies.every((c) => selectedCompanies.has(c.id))} />
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: '#475569', fontWeight: 600 }}>업체명</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: '#475569', fontWeight: 600 }}>대표자</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: '#475569', fontWeight: 600 }}>지사</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: '#475569', fontWeight: 600 }}>결제일</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: '#475569', fontWeight: 600 }}>담당자</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>로딩중...</td></tr>
                ) : companies.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', background: selectedCompanies.has(c.id) ? '#f5f3ff' : '' }}>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <input type="checkbox" checked={selectedCompanies.has(c.id)} onChange={() => toggleCompany(c.id)} />
                    </td>
                    <td style={{ padding: '8px', fontWeight: 500 }}>{c.companyName}</td>
                    <td style={{ padding: '8px' }}>{c.representative}</td>
                    <td style={{ padding: '8px', fontSize: 12, color: '#64748b' }}>{c.branch}</td>
                    <td style={{ padding: '8px', fontSize: 12, color: '#64748b' }}>{new Date(c.paymentDate).toLocaleDateString('ko-KR')}</td>
                    <td style={{ padding: '8px', fontSize: 12, color: c.upsellAssignments.length > 0 ? '#8b5cf6' : '#cbd5e1' }}>
                      {c.upsellAssignments[0]?.assignedTo?.displayName || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 12 }}>
              <button disabled={page === 1} onClick={() => setPage(page - 1)}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, cursor: page === 1 ? 'default' : 'pointer' }}>이전</button>
              <span style={{ padding: '5px 10px', fontSize: 12, color: '#64748b' }}>{page}/{totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage(page + 1)}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, cursor: page === totalPages ? 'default' : 'pointer' }}>다음</button>
            </div>
          )}
        </div>

        {/* 우측: 팀원 목록 + 분배 버튼 */}
        <div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, position: 'sticky', top: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#0f172a' }}>분배 대상</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
              {members.map((m) => (
                <label key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  border: selectedMember === m.id ? '2px solid #8b5cf6' : '1px solid #e2e8f0',
                  borderRadius: 8, cursor: 'pointer', background: selectedMember === m.id ? '#f5f3ff' : '#fff',
                }}>
                  <input type="radio" name="member" checked={selectedMember === m.id} onChange={() => setSelectedMember(m.id)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{m.displayName}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {ROLE_LABELS[m.role] || m.role} · {m._count.assignedUpsell}건
                    </div>
                  </div>
                </label>
              ))}
              {members.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>팀원이 없습니다.</div>
              )}
            </div>

            <button onClick={handleDistribute} disabled={distributing || selectedCompanies.size === 0 || !selectedMember}
              style={{
                width: '100%', padding: '12px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8,
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
                opacity: distributing || selectedCompanies.size === 0 || !selectedMember ? 0.5 : 1,
              }}>
              {distributing ? '분배 중...' : `${selectedCompanies.size}건 분배하기`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
