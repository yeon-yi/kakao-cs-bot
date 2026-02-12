'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

export default function AssigneesPage() {
  const [editCategory, setEditCategory] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: assignees, isLoading: assigneesLoading } = trpc.escalation.assignees.list.useQuery();
  const { data: staffList, isLoading: staffLoading } = trpc.escalation.staffList.useQuery();

  const setMutation = trpc.escalation.assignees.set.useMutation({
    onSuccess: () => {
      utils.escalation.assignees.list.invalidate();
      setEditCategory(null);
      setSelectedStaffId(null);
    },
  });

  const removeMutation = trpc.escalation.assignees.remove.useMutation({
    onSuccess: () => utils.escalation.assignees.list.invalidate(),
  });

  const assigneeMap = new Map<string, any>();
  assignees?.forEach((a: any) => assigneeMap.set(a.category, a));

  function handleSave(category: string) {
    if (!selectedStaffId) return;
    setMutation.mutate({ category, staffId: selectedStaffId });
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">카테고리별 담당자</h1>
      <p className="text-muted-foreground text-sm mb-6">
        봇이 답변하지 못한 질문이 발생하면 해당 카테고리의 담당자에게 자동으로 배정됩니다.
      </p>

      {(assigneesLoading || staffLoading) ? (
        <p className="text-muted-foreground">로딩 중...</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">카테고리</th>
                <th className="px-4 py-3 text-left font-medium">담당자</th>
                <th className="px-4 py-3 text-right font-medium w-40">작업</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((category) => {
                const assignee = assigneeMap.get(category);
                const staff = assignee?.company_staff;
                const isEditing = editCategory === category;

                return (
                  <tr key={category} className="border-b hover:bg-muted/25">
                    <td className="px-4 py-3 font-medium">{category}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={selectedStaffId ?? ''}
                          onChange={(e) => setSelectedStaffId(Number(e.currentTarget.value) || null)}
                          className="p-1.5 border rounded text-sm w-full max-w-xs"
                          autoFocus
                        >
                          <option value="">선택하세요</option>
                          {staffList?.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.real_name} {s.department ? `(${s.department})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : staff ? (
                        <span>
                          {staff.real_name}
                          {staff.department && (
                            <span className="text-muted-foreground ml-1">({staff.department})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">미지정</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => handleSave(category)}
                            disabled={!selectedStaffId || setMutation.isPending}
                            className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            저장
                          </button>
                          <button
                            onClick={() => { setEditCategory(null); setSelectedStaffId(null); }}
                            className="px-3 py-1 bg-zinc-200 text-zinc-600 text-xs rounded"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => {
                              setEditCategory(category);
                              setSelectedStaffId(assignee?.staff_id ?? null);
                            }}
                            className="px-3 py-1 border text-xs rounded hover:bg-muted"
                          >
                            {staff ? '변경' : '지정'}
                          </button>
                          {staff && (
                            <button
                              onClick={() => removeMutation.mutate({ category })}
                              disabled={removeMutation.isPending}
                              className="px-3 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                            >
                              해제
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {setMutation.error && (
        <p className="mt-2 text-sm text-destructive">{setMutation.error.message}</p>
      )}
    </div>
  );
}
