'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

interface StaffForm {
  realName: string;
  kakaoName: string;
  kakaoUserId: string;
  email: string;
  phone: string;
  department: string;
  position: string;
}

const emptyForm: StaffForm = {
  realName: '', kakaoName: '', kakaoUserId: '',
  email: '', phone: '', department: '', position: '',
};

export default function StaffPage() {
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState<StaffForm>(emptyForm);

  const utils = trpc.useUtils();
  const { data: staffList, isLoading } = trpc.staff.list.useQuery({
    search: search || undefined,
    activeOnly: !showInactive,
  });

  const createMutation = trpc.staff.create.useMutation({
    onSuccess: () => {
      utils.staff.list.invalidate();
      setIsAdding(false);
      setForm(emptyForm);
    },
  });

  const updateMutation = trpc.staff.update.useMutation({
    onSuccess: () => {
      utils.staff.list.invalidate();
      setEditId(null);
      setForm(emptyForm);
    },
  });

  const toggleMutation = trpc.staff.toggleActive.useMutation({
    onSuccess: () => utils.staff.list.invalidate(),
  });

  function startEdit(staff: any) {
    setEditId(staff.id);
    setIsAdding(false);
    setForm({
      realName: staff.real_name || '',
      kakaoName: staff.kakao_name || '',
      kakaoUserId: staff.kakao_user_id || '',
      email: staff.email || '',
      phone: staff.phone || '',
      department: staff.department || '',
      position: staff.position || '',
    });
  }

  function startAdd() {
    setIsAdding(true);
    setEditId(null);
    setForm(emptyForm);
  }

  function cancel() {
    setIsAdding(false);
    setEditId(null);
    setForm(emptyForm);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editId) {
      updateMutation.mutate({ id: editId, ...form });
    } else {
      createMutation.mutate(form);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error || updateMutation.error;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">직원 관리</h1>
          <p className="text-muted-foreground text-sm mt-1">
            카카오톡 봇에서 직원으로 인식될 사람을 등록합니다.
          </p>
        </div>
        {!isAdding && !editId && (
          <button
            onClick={startAdd}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            + 직원 추가
          </button>
        )}
      </div>

      {/* 추가/수정 폼 */}
      {(isAdding || editId) && (
        <form onSubmit={handleSubmit} className="mb-6 border rounded-lg p-4 bg-muted/30">
          <h2 className="text-sm font-semibold mb-3">
            {editId ? '직원 정보 수정' : '새 직원 추가'}
          </h2>

          {error && (
            <div className="mb-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
              {error.message}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium mb-1">이름 *</label>
              <input
                type="text" required value={form.realName}
                onChange={(e) => setForm({ ...form, realName: e.currentTarget.value })}
                className="w-full rounded border px-2.5 py-1.5 text-sm"
                placeholder="홍길동"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">카카오 이름</label>
              <input
                type="text" value={form.kakaoName}
                onChange={(e) => setForm({ ...form, kakaoName: e.currentTarget.value })}
                className="w-full rounded border px-2.5 py-1.5 text-sm"
                placeholder="카카오톡 프로필 이름"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">부서</label>
              <input
                type="text" value={form.department}
                onChange={(e) => setForm({ ...form, department: e.currentTarget.value })}
                className="w-full rounded border px-2.5 py-1.5 text-sm"
                placeholder="마케팅팀"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">직책</label>
              <input
                type="text" value={form.position}
                onChange={(e) => setForm({ ...form, position: e.currentTarget.value })}
                className="w-full rounded border px-2.5 py-1.5 text-sm"
                placeholder="대리"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">이메일</label>
              <input
                type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
                className="w-full rounded border px-2.5 py-1.5 text-sm"
                placeholder="hong@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">전화번호</label>
              <input
                type="text" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.currentTarget.value })}
                className="w-full rounded border px-2.5 py-1.5 text-sm"
                placeholder="010-1234-5678"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit" disabled={isPending}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? '저장 중...' : editId ? '수정' : '추가'}
            </button>
            <button
              type="button" onClick={cancel}
              className="px-4 py-1.5 border text-sm rounded hover:bg-muted"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {/* 검색/필터 */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text" value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          className="flex-1 rounded border px-3 py-1.5 text-sm"
          placeholder="이름, 카카오이름, 부서로 검색..."
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox" checked={showInactive}
            onChange={(e) => setShowInactive(e.currentTarget.checked)}
          />
          비활성 포함
        </label>
      </div>

      {/* 직원 목록 */}
      {isLoading ? (
        <p className="text-muted-foreground text-sm">로딩 중...</p>
      ) : !staffList?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">등록된 직원이 없습니다.</p>
          <button onClick={startAdd} className="mt-2 text-sm text-blue-600 hover:underline">
            첫 직원을 추가해 보세요
          </button>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium">이름</th>
                <th className="px-4 py-2.5 text-left font-medium">카카오</th>
                <th className="px-4 py-2.5 text-left font-medium">부서</th>
                <th className="px-4 py-2.5 text-left font-medium">직책</th>
                <th className="px-4 py-2.5 text-left font-medium">연락처</th>
                <th className="px-4 py-2.5 text-right font-medium w-32">작업</th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((staff: any) => (
                <tr
                  key={staff.id}
                  className={`border-b hover:bg-muted/25 ${!staff.is_active ? 'opacity-40' : ''}`}
                >
                  <td className="px-4 py-2.5 font-medium">{staff.real_name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{staff.kakao_name || '-'}</td>
                  <td className="px-4 py-2.5">{staff.department || '-'}</td>
                  <td className="px-4 py-2.5">{staff.position || '-'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    {staff.phone || staff.email || '-'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => startEdit(staff)}
                        className="px-2 py-0.5 text-xs border rounded hover:bg-muted"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => toggleMutation.mutate({ id: staff.id, isActive: !staff.is_active })}
                        disabled={toggleMutation.isPending}
                        className={`px-2 py-0.5 text-xs rounded ${
                          staff.is_active
                            ? 'text-red-600 hover:bg-red-50'
                            : 'text-green-600 hover:bg-green-50'
                        }`}
                      >
                        {staff.is_active ? '비활성' : '활성화'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        총 {staffList?.length ?? 0}명
        {!showInactive && ' (활성 직원만 표시)'}
      </p>
    </div>
  );
}
