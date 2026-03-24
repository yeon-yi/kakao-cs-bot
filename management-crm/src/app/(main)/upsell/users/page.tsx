'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client';

interface UpsellUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
  createdBy: { displayName: string } | null;
  _count: { assignedUpsell: number };
}

interface AuthUser {
  userId: number;
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  upselling_director: '실장',
  upselling_chief: '주임',
  upselling_staff: '사원',
};

export default function UpsellUsersPage() {
  const [users, setUsers] = useState<UpsellUser[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<UpsellUser | null>(null);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'upselling_staff' });
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      setLoadError('');
      const data = await apiGet<{ users: UpsellUser[] }>('/api/upsell/users');
      setUsers(data.users);
    } catch (e) {
      console.error(e);
      setLoadError('팀원 목록을 불러올 수 없습니다.');
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [authData, userData] = await Promise.all([
        apiGet<{ user: AuthUser }>('/api/auth'),
        apiGet<{ users: UpsellUser[] }>('/api/upsell/users'),
      ]);
      setAuthUser(authData.user);
      setUsers(userData.users);
    } catch (e) {
      console.error(e);
      setLoadError('데이터를 불러올 수 없습니다. 새로고침하거나 아래 버튼을 눌러주세요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const creatableRoles = (() => {
    if (!authUser) return [];
    if (authUser.role === 'admin') return ['upselling_director', 'upselling_chief', 'upselling_staff'];
    if (authUser.role === 'upselling_director') return ['upselling_chief', 'upselling_staff'];
    if (authUser.role === 'upselling_chief') return ['upselling_staff'];
    return [];
  })();

  const openCreate = () => {
    setEditUser(null);
    setForm({ username: '', password: '', displayName: '', role: creatableRoles[0] || 'upselling_staff' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (u: UpsellUser) => {
    setEditUser(u);
    setForm({ username: u.username, password: '', displayName: u.displayName, role: u.role });
    setError('');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setError('');
    try {
      if (editUser) {
        await apiPut('/api/upsell/users', { id: editUser.id, ...form, password: form.password || undefined });
      } else {
        if (!form.password) { setError('비밀번호를 입력하세요.'); return; }
        await apiPost('/api/upsell/users', form);
      }
      setShowModal(false);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    }
  };

  const handleDelete = async (u: UpsellUser) => {
    if (!confirm(`${u.displayName} 계정을 삭제하시겠습니까?`)) return;
    try {
      await apiDelete(`/api/upsell/users?id=${u.id}`);
      await loadUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>로딩중...</div>;

  if (loadError) return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ color: '#ef4444', marginBottom: 16 }}>{loadError}</div>
      <button onClick={loadAll} style={{ padding: '8px 20px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>다시 시도</button>
    </div>
  );

  return (
    <div className="crm-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>팀원 관리</h1>
        {creatableRoles.length > 0 && (
          <button onClick={openCreate} style={{ padding: '8px 16px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + 팀원 추가
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontWeight: 500 }}>이름</th>
              <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontWeight: 500 }}>아이디</th>
              <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontWeight: 500 }}>직책</th>
              <th style={{ textAlign: 'right', padding: '12px 16px', color: '#64748b', fontWeight: 500 }}>분배 업체</th>
              <th style={{ textAlign: 'left', padding: '12px 16px', color: '#64748b', fontWeight: 500 }}>생성자</th>
              <th style={{ textAlign: 'center', padding: '12px 16px', color: '#64748b', fontWeight: 500 }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>팀원이 없습니다.</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 16px', fontWeight: 500 }}>{u.displayName}</td>
                <td style={{ padding: '10px 16px', color: '#64748b' }}>{u.username}</td>
                <td style={{ padding: '10px 16px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                    background: u.role === 'upselling_director' ? '#ede9fe' : u.role === 'upselling_chief' ? '#e0f2fe' : '#f0fdf4',
                    color: u.role === 'upselling_director' ? '#7c3aed' : u.role === 'upselling_chief' ? '#0284c7' : '#16a34a',
                  }}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600 }}>{u._count.assignedUpsell}</td>
                <td style={{ padding: '10px 16px', color: '#94a3b8', fontSize: 12 }}>{u.createdBy?.displayName || '-'}</td>
                <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                  {creatableRoles.includes(u.role) ? (
                    <>
                      <button onClick={() => openEdit(u)} style={{ padding: '4px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, cursor: 'pointer', marginRight: 4 }}>수정</button>
                      <button onClick={() => handleDelete(u)} style={{ padding: '4px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 12, cursor: 'pointer', color: '#dc2626' }}>삭제</button>
                    </>
                  ) : (
                    <span style={{ color: '#cbd5e1', fontSize: 12 }}>-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 생성/수정 모달 */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>{editUser ? '팀원 수정' : '팀원 추가'}</h3>

            {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 13, color: '#374151' }}>
                이름
                <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
              </label>
              <label style={{ fontSize: 13, color: '#374151' }}>
                아이디
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                  style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
              </label>
              <label style={{ fontSize: 13, color: '#374151' }}>
                비밀번호 {editUser && <span style={{ color: '#94a3b8' }}>(미입력 시 유지)</span>}
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginTop: 4, boxSizing: 'border-box' }} />
              </label>
              <label style={{ fontSize: 13, color: '#374151' }}>
                직책
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                  style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginTop: 4, boxSizing: 'border-box' }}>
                  {creatableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>취소</button>
              <button onClick={handleSubmit} style={{ padding: '8px 16px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {editUser ? '수정' : '생성'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
