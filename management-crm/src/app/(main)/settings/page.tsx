'use client';

import { useState, useEffect, type FormEvent } from 'react';

export default function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Auth
  const [authRole, setAuthRole] = useState('');
  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' }).then(r => r.json()).then(d => setAuthRole(d.user?.role || '')).catch(() => {});
  }, []);

  // 모집플레이스 계정
  const [hjId, setHjId] = useState('');
  const [hjPw, setHjPw] = useState('');
  const [hjPw2, setHjPw2] = useState('');
  const [hjStatus, setHjStatus] = useState<{ id: string; pwSet: boolean; pw2Set: boolean } | null>(null);
  const [hjTesting, setHjTesting] = useState(false);
  const [hjSaving, setHjSaving] = useState(false);
  const [hjMsg, setHjMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // 관리팀 지사 매핑 (월별)
  const [teamBranches, setTeamBranches] = useState<{ team1: string[]; team2: string[] }>({ team1: [], team2: [] });
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamCopying, setTeamCopying] = useState(false);
  const [teamMsg, setTeamMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [teamYearMonth, setTeamYearMonth] = useState('');
  const [teamAvailableMonths, setTeamAvailableMonths] = useState<string[]>([]);

  useEffect(() => {
    if (authRole === 'admin') {
      fetch('/api/settings/homejeonsan', { credentials: 'include' })
        .then(r => r.json())
        .then(d => { setHjStatus(d); setHjId(d.id === '(미설정)' ? '' : d.id); })
        .catch(() => {});
      fetch('/api/settings/mgmt-teams', { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          setTeamBranches({ team1: d.team1Branches || [], team2: d.team2Branches || [] });
          setTeamYearMonth(d.yearMonth || '');
          setTeamAvailableMonths(d.availableMonths || []);
        })
        .catch(() => {});
    }
  }, [authRole]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (!currentPassword) {
      setError('현재 비밀번호를 입력해주세요.');
      return;
    }
    if (!newPassword) {
      setError('새 비밀번호를 입력해주세요.');
      return;
    }
    if (newPassword.length < 4) {
      setError('새 비밀번호는 최소 4자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || '비밀번호 변경에 실패했습니다.');
      }

      setSuccess('비밀번호가 변경되었습니다.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-[640px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0f172a] tracking-tight">설정</h1>
        <p className="text-[#64748b] text-sm mt-1">비밀번호를 변경합니다.</p>
      </div>

      {/* Password change card */}
      <div className="bg-white border border-[#e2e8f0]">
        <div className="px-6 py-4 border-b border-[#e2e8f0]">
          <h2 className="text-[15px] font-semibold text-[#0f172a]">비밀번호 변경</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div>
              <label
                htmlFor="currentPassword"
                className="block text-[13px] font-medium text-[#334155] mb-1.5"
              >
                현재 비밀번호
              </label>
              <input
                id="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setError('');
                  setSuccess('');
                }}
                placeholder="현재 비밀번호를 입력하세요"
                className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
              />
            </div>

            <div>
              <label
                htmlFor="newPassword"
                className="block text-[13px] font-medium text-[#334155] mb-1.5"
              >
                새 비밀번호
              </label>
              <input
                id="newPassword"
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError('');
                  setSuccess('');
                }}
                placeholder="최소 4자 이상"
                className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-[13px] font-medium text-[#334155] mb-1.5"
              >
                새 비밀번호 확인
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError('');
                  setSuccess('');
                }}
                placeholder="새 비밀번호를 다시 입력하세요"
                className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb] transition-colors duration-100"
              />
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-4 flex items-start gap-2 bg-[#fef2f2] border border-[#fecaca] px-3 py-2.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="shrink-0 mt-0.5"
              >
                <circle cx="8" cy="8" r="7" stroke="#dc2626" strokeWidth="1.5" />
                <path d="M8 4.5V8.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="8" cy="11" r="0.75" fill="#dc2626" />
              </svg>
              <p className="text-[#dc2626] text-[13px] leading-5">{error}</p>
            </div>
          )}

          {/* Success message */}
          {success && (
            <div className="mt-4 flex items-start gap-2 bg-[#f0fdf4] border border-[#bbf7d0] px-3 py-2.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="shrink-0 mt-0.5"
              >
                <circle cx="8" cy="8" r="7" stroke="#16a34a" strokeWidth="1.5" />
                <path d="M5.5 8l2 2 3.5-4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-[#16a34a] text-[13px] leading-5">{success}</p>
            </div>
          )}

          {/* Submit */}
          <div className="mt-6 pt-4 border-t border-[#f1f5f9]">
            <button
              type="submit"
              disabled={loading}
              className="h-9 px-5 text-[13px] font-medium text-white bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 cursor-pointer"
            >
              {loading ? '변경중...' : '비밀번호 변경'}
            </button>
          </div>
        </form>
      </div>
      {/* 모집플레이스 계정 관리 (admin만) */}
      {authRole === 'admin' && (
        <div className="bg-white border border-[#e2e8f0] mt-6">
          <div className="px-6 py-4 border-b border-[#e2e8f0] flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[#0f172a]">모집플레이스 계정</h2>
            {hjStatus && (
              <span className="text-[12px]" style={{ color: hjStatus.pwSet ? '#16a34a' : '#dc2626' }}>
                {hjStatus.pwSet ? '설정됨' : '미설정'}
              </span>
            )}
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-[#334155] mb-1.5">아이디</label>
              <input type="text" value={hjId} onChange={(e) => { setHjId(e.target.value); setHjMsg(null); }}
                placeholder="모집플레이스 로그인 ID"
                className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb]" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#334155] mb-1.5">비밀번호</label>
              <input type="password" value={hjPw} onChange={(e) => { setHjPw(e.target.value); setHjMsg(null); }}
                placeholder={hjStatus?.pwSet ? '(변경 시에만 입력)' : '비밀번호'}
                className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb]" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#334155] mb-1.5">2차 비밀번호</label>
              <input type="password" value={hjPw2} onChange={(e) => { setHjPw2(e.target.value); setHjMsg(null); }}
                placeholder={hjStatus?.pw2Set ? '(변경 시에만 입력)' : '2차 비밀번호'}
                className="w-full h-10 px-3 text-[13.5px] text-[#0f172a] placeholder:text-[#cbd5e1] border border-[#e2e8f0] bg-white outline-none focus:border-[#2563eb]" />
            </div>

            {hjMsg && (
              <div className={`flex items-center gap-2 px-3 py-2.5 border ${hjMsg.type === 'ok' ? 'bg-[#f0fdf4] border-[#bbf7d0]' : 'bg-[#fef2f2] border-[#fecaca]'}`}>
                <p className={`text-[13px] ${hjMsg.type === 'ok' ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>{hjMsg.text}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" disabled={hjTesting}
                onClick={async () => {
                  setHjTesting(true); setHjMsg(null);
                  try {
                    const res = await fetch('/api/settings/homejeonsan', {
                      method: 'POST', credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'test' }),
                    });
                    const d = await res.json();
                    setHjMsg({ type: d.ok ? 'ok' : 'err', text: d.message });
                  } catch { setHjMsg({ type: 'err', text: '테스트 실패' }); }
                  finally { setHjTesting(false); }
                }}
                className="h-9 px-5 text-[13px] font-medium border border-[#e2e8f0] bg-[#f8fafc] hover:bg-[#f1f5f9] disabled:opacity-50 cursor-pointer transition-colors">
                {hjTesting ? '테스트중...' : '연결 테스트'}
              </button>
              <button type="button" disabled={hjSaving || (!hjId && !hjPw && !hjPw2)}
                onClick={async () => {
                  if (!hjId || !hjPw || !hjPw2) { setHjMsg({ type: 'err', text: '모든 필드를 입력해주세요.' }); return; }
                  setHjSaving(true); setHjMsg(null);
                  try {
                    const res = await fetch('/api/settings/homejeonsan', {
                      method: 'POST', credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'update', hjId, hjPw, hjPw2 }),
                    });
                    const d = await res.json();
                    setHjMsg({ type: d.ok ? 'ok' : 'err', text: d.message });
                    if (d.ok) { setHjPw(''); setHjPw2(''); }
                  } catch { setHjMsg({ type: 'err', text: '저장 실패' }); }
                  finally { setHjSaving(false); }
                }}
                className="h-9 px-5 text-[13px] font-medium text-white bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 cursor-pointer transition-colors">
                {hjSaving ? '저장중...' : '저장 및 연결 확인'}
              </button>
            </div>
          </div>
        </div>
      )}
      {authRole === 'admin' && (
        <div className="bg-white border border-[#e2e8f0] mt-6">
          <div className="px-6 py-4 border-b border-[#e2e8f0] flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[#0f172a]">관리팀 지사 매핑 (월별)</h2>
            {teamYearMonth && (
              <span className="text-[12px] font-medium" style={{ color: '#f59e0b' }}>
                {teamYearMonth} 편집중
              </span>
            )}
          </div>
          <div className="p-6 space-y-5">
            {/* Month selector */}
            <div>
              <label className="block text-[13px] font-medium text-[#334155] mb-2">대상 월</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={teamYearMonth}
                  onChange={async (e) => {
                    const ym = e.target.value;
                    setTeamYearMonth(ym);
                    setTeamMsg(null);
                    try {
                      const res = await fetch(`/api/settings/mgmt-teams?yearMonth=${ym}`, { credentials: 'include' });
                      const d = await res.json();
                      setTeamBranches({ team1: d.team1Branches || [], team2: d.team2Branches || [] });
                      setTeamAvailableMonths(d.availableMonths || []);
                    } catch { /* silent */ }
                  }}
                  className="h-9 px-3 text-[13px] border border-[#e2e8f0] bg-white outline-none focus:border-[#f59e0b] cursor-pointer"
                >
                  {(() => {
                    // Build list: available months + next month (if not already present)
                    const now = new Date();
                    const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                    const nextYM = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
                    const allMonths = [...new Set([...teamAvailableMonths, curYM, nextYM])].sort().reverse();
                    return allMonths.map(m => <option key={m} value={m}>{m}</option>);
                  })()}
                </select>
                <span className="text-[12px] text-[#94a3b8]">매핑을 조회/편집할 월을 선택하세요</span>
              </div>
            </div>

            {(['team1', 'team2'] as const).map((team) => (
              <div key={team}>
                <label className="block text-[13px] font-medium text-[#334155] mb-2">
                  {team === 'team1' ? '1팀' : '2팀'} 담당 지사
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['인천', '수원', '동탄', '용인', '부산', '본사'].map(b => {
                    const selected = teamBranches[team].includes(b);
                    return (
                      <label key={b} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', border: '1px solid', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                        borderColor: selected ? '#f59e0b' : '#e2e8f0',
                        background: selected ? '#fffbeb' : '#fff',
                        color: selected ? '#d97706' : '#64748b',
                      }}>
                        <input type="checkbox" checked={selected}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...teamBranches[team], b]
                              : teamBranches[team].filter(v => v !== b);
                            setTeamBranches({ ...teamBranches, [team]: next });
                            setTeamMsg(null);
                          }}
                          style={{ accentColor: '#f59e0b' }} />
                        {b}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            {teamMsg && (
              <div className={`flex items-center gap-2 px-3 py-2.5 border ${teamMsg.type === 'ok' ? 'bg-[#f0fdf4] border-[#bbf7d0]' : 'bg-[#fef2f2] border-[#fecaca]'}`}>
                <p className={`text-[13px] ${teamMsg.type === 'ok' ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>{teamMsg.text}</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={teamSaving || !teamYearMonth}
                onClick={async () => {
                  setTeamSaving(true); setTeamMsg(null);
                  try {
                    const res = await fetch('/api/settings/mgmt-teams', {
                      method: 'PUT', credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ yearMonth: teamYearMonth, team1Branches: teamBranches.team1, team2Branches: teamBranches.team2 }),
                    });
                    const d = await res.json();
                    setTeamMsg({ type: res.ok ? 'ok' : 'err', text: d.message || (res.ok ? '저장되었습니다.' : '저장 실패') });
                    if (res.ok) {
                      // Refresh available months
                      const r2 = await fetch(`/api/settings/mgmt-teams?yearMonth=${teamYearMonth}`, { credentials: 'include' });
                      const d2 = await r2.json();
                      setTeamAvailableMonths(d2.availableMonths || []);
                    }
                  } catch { setTeamMsg({ type: 'err', text: '저장 실패' }); }
                  finally { setTeamSaving(false); }
                }}
                className="h-9 px-5 text-[13px] font-medium text-white bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-50 cursor-pointer transition-colors">
                {teamSaving ? '저장중...' : `${teamYearMonth} 매핑 저장`}
              </button>
              <button type="button" disabled={teamCopying || !teamYearMonth}
                onClick={async () => {
                  const now = new Date();
                  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                  const nextYM = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
                  if (!window.confirm(`${teamYearMonth} 매핑을 ${nextYM}로 복사하시겠습니까?`)) return;
                  setTeamCopying(true); setTeamMsg(null);
                  try {
                    const res = await fetch('/api/settings/mgmt-teams', {
                      method: 'POST', credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sourceMonth: teamYearMonth, targetMonth: nextYM }),
                    });
                    const d = await res.json();
                    setTeamMsg({ type: res.ok ? 'ok' : 'err', text: d.message || (res.ok ? '복사 완료' : '복사 실패') });
                    if (res.ok) {
                      // Refresh available months
                      const r2 = await fetch(`/api/settings/mgmt-teams?yearMonth=${teamYearMonth}`, { credentials: 'include' });
                      const d2 = await r2.json();
                      setTeamAvailableMonths(d2.availableMonths || []);
                    }
                  } catch { setTeamMsg({ type: 'err', text: '복사 실패' }); }
                  finally { setTeamCopying(false); }
                }}
                className="h-9 px-5 text-[13px] font-medium border border-[#e2e8f0] bg-[#f8fafc] hover:bg-[#f1f5f9] disabled:opacity-50 cursor-pointer transition-colors">
                {teamCopying ? '복사중...' : '다음달 복사'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
