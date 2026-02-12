'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const DEFAULT_CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

export default function AssigneesPage() {
  const [editCategory, setEditCategory] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);

  // 카테고리 관리 상태
  const [newCategory, setNewCategory] = useState('');
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const utils = trpc.useUtils();
  const { data: assignees, isLoading: assigneesLoading } = trpc.escalation.assignees.list.useQuery();
  const { data: staffList, isLoading: staffLoading } = trpc.escalation.staffList.useQuery();
  const { data: categoriesConfig } = trpc.config.get.useQuery(
    { key: 'escalation.categories' },
    { retry: false },
  );

  // 저장된 카테고리 목록 (없으면 기본값)
  const categories: string[] = categoriesConfig?.value ?? DEFAULT_CATEGORIES;

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

  const saveCategoriesMutation = trpc.config.update.useMutation({
    onSuccess: () => utils.config.get.invalidate({ key: 'escalation.categories' }),
  });

  const assigneeMap = new Map<string, any>();
  assignees?.forEach((a: any) => assigneeMap.set(a.category, a));

  function handleSave(category: string) {
    if (!selectedStaffId) return;
    setMutation.mutate({ category, staffId: selectedStaffId });
  }

  function saveCategories(newList: string[]) {
    saveCategoriesMutation.mutate({
      key: 'escalation.categories',
      value: newList,
    });
  }

  function addCategory() {
    const name = newCategory.trim();
    if (!name || categories.includes(name)) return;
    saveCategories([...categories, name]);
    setNewCategory('');
  }

  function removeCategory(cat: string) {
    if (!confirm(`"${cat}" 카테고리를 삭제하시겠습니까?\n해당 카테고리의 담당자 설정도 함께 해제됩니다.`)) return;
    // 담당자 해제
    if (assigneeMap.has(cat)) {
      removeMutation.mutate({ category: cat });
    }
    saveCategories(categories.filter(c => c !== cat));
  }

  function startRename(cat: string) {
    setRenamingCategory(cat);
    setRenameValue(cat);
  }

  function confirmRename(oldName: string) {
    const newName = renameValue.trim();
    if (!newName || newName === oldName) {
      setRenamingCategory(null);
      return;
    }
    if (categories.includes(newName)) {
      alert('이미 존재하는 카테고리 이름입니다.');
      return;
    }
    // 카테고리 이름 변경
    const newList = categories.map(c => c === oldName ? newName : c);
    saveCategories(newList);

    // 기존 담당자가 있으면 새 카테고리로 재설정
    const existing = assigneeMap.get(oldName);
    if (existing) {
      removeMutation.mutate({ category: oldName });
      setMutation.mutate({ category: newName, staffId: existing.staff_id });
    }
    setRenamingCategory(null);
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
        <>
          <div className="border rounded-lg overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">카테고리</th>
                  <th className="px-4 py-3 text-left font-medium">담당자</th>
                  <th className="px-4 py-3 text-right font-medium w-52">작업</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const assignee = assigneeMap.get(category);
                  const staff = assignee?.company_staff;
                  const isEditing = editCategory === category;
                  const isRenaming = renamingCategory === category;

                  return (
                    <tr key={category} className="border-b hover:bg-muted/25">
                      <td className="px-4 py-3 font-medium">
                        {isRenaming ? (
                          <div className="flex gap-1.5 items-center">
                            <input
                              type="text" value={renameValue}
                              onChange={(e) => setRenameValue(e.currentTarget.value)}
                              className="border rounded px-2 py-0.5 text-sm w-32"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmRename(category);
                                if (e.key === 'Escape') setRenamingCategory(null);
                              }}
                            />
                            <button
                              onClick={() => confirmRename(category)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              확인
                            </button>
                            <button
                              onClick={() => setRenamingCategory(null)}
                              className="text-xs text-muted-foreground hover:underline"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <span
                            className="cursor-pointer hover:text-blue-600"
                            onDoubleClick={() => startRename(category)}
                            title="더블클릭하여 이름 변경"
                          >
                            {category}
                          </span>
                        )}
                      </td>
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
                              className="px-2.5 py-1 border text-xs rounded hover:bg-muted"
                            >
                              {staff ? '변경' : '지정'}
                            </button>
                            <button
                              onClick={() => startRename(category)}
                              className="px-2.5 py-1 text-xs text-zinc-500 hover:bg-muted rounded"
                            >
                              이름변경
                            </button>
                            {staff && (
                              <button
                                onClick={() => removeMutation.mutate({ category })}
                                disabled={removeMutation.isPending}
                                className="px-2.5 py-1 text-xs text-orange-600 hover:bg-orange-50 rounded"
                              >
                                해제
                              </button>
                            )}
                            <button
                              onClick={() => removeCategory(category)}
                              className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                            >
                              삭제
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 카테고리 추가 */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <h3 className="text-sm font-semibold mb-2">카테고리 추가</h3>
            <div className="flex gap-2">
              <input
                type="text" value={newCategory}
                onChange={(e) => setNewCategory(e.currentTarget.value)}
                className="flex-1 rounded border px-3 py-1.5 text-sm"
                placeholder="새 카테고리 이름 입력"
                onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }}
              />
              <button
                onClick={addCategory}
                disabled={!newCategory.trim() || saveCategoriesMutation.isPending}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </div>
        </>
      )}

      {(setMutation.error || saveCategoriesMutation.error) && (
        <p className="mt-2 text-sm text-destructive">
          {setMutation.error?.message || saveCategoriesMutation.error?.message}
        </p>
      )}
    </div>
  );
}
