'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserCog, Plus, Pencil, Trash2, Check, X, Type } from 'lucide-react';

const DEFAULT_CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

export default function AssigneesPage() {
  const [editCategory, setEditCategory] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
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
    saveCategoriesMutation.mutate({ key: 'escalation.categories', value: newList });
  }

  function addCategory() {
    const name = newCategory.trim();
    if (!name || categories.includes(name)) return;
    saveCategories([...categories, name]);
    setNewCategory('');
  }

  function removeCategory(cat: string) {
    if (!confirm(`"${cat}" 카테고리를 삭제하시겠습니까?\n해당 카테고리의 담당자 설정도 함께 해제됩니다.`)) return;
    if (assigneeMap.has(cat)) removeMutation.mutate({ category: cat });
    saveCategories(categories.filter(c => c !== cat));
  }

  function startRename(cat: string) {
    setRenamingCategory(cat);
    setRenameValue(cat);
  }

  function confirmRename(oldName: string) {
    const newName = renameValue.trim();
    if (!newName || newName === oldName) { setRenamingCategory(null); return; }
    if (categories.includes(newName)) { alert('이미 존재하는 카테고리 이름입니다.'); return; }
    saveCategories(categories.map(c => c === oldName ? newName : c));
    const existing = assigneeMap.get(oldName);
    if (existing) {
      removeMutation.mutate({ category: oldName });
      setMutation.mutate({ category: newName, staffId: existing.staff_id });
    }
    setRenamingCategory(null);
  }

  const isLoading = assigneesLoading || staffLoading;
  const assignedCount = categories.filter(c => assigneeMap.has(c)).length;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">담당자 배정</h1>
            <p className="text-sm text-zinc-500 mt-1">
              에스컬레이션 발생 시 카테고리별로 담당자를 자동 배정합니다. 미지정 카테고리는 전체 담당자에게 배정됩니다.
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            {assignedCount}/{categories.length} 배정
          </Badge>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <>
          <Card className="p-0 overflow-hidden mb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50">
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">카테고리</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">담당자</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 w-48">작업</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const assignee = assigneeMap.get(category);
                  const staff = assignee?.company_staff;
                  const isEditing = editCategory === category;
                  const isRenaming = renamingCategory === category;

                  return (
                    <tr key={category} className="border-b last:border-0 hover:bg-zinc-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {isRenaming ? (
                          <div className="flex gap-1.5 items-center">
                            <Input
                              type="text" value={renameValue}
                              onChange={(e) => setRenameValue(e.currentTarget.value)}
                              className="w-32 text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmRename(category);
                                if (e.key === 'Escape') setRenamingCategory(null);
                              }}
                            />
                            <button onClick={() => confirmRename(category)}
                              className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50">
                              <Check size={14} />
                            </button>
                            <button onClick={() => setRenamingCategory(null)}
                              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100">
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <span className="cursor-pointer hover:text-blue-600"
                            onDoubleClick={() => startRename(category)} title="더블클릭하여 이름 변경">
                            {category}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select value={selectedStaffId ?? ''}
                            onChange={(e) => setSelectedStaffId(Number(e.currentTarget.value) || null)}
                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                            autoFocus>
                            <option value="">선택하세요</option>
                            {staffList?.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.real_name} {s.department ? `(${s.department})` : ''}
                              </option>
                            ))}
                          </select>
                        ) : staff ? (
                          <span className="text-zinc-700">
                            {staff.real_name}
                            {staff.department && <span className="text-zinc-400 ml-1">({staff.department})</span>}
                          </span>
                        ) : (
                          <span className="text-zinc-300 text-xs">미지정</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" onClick={() => handleSave(category)}
                              disabled={!selectedStaffId || setMutation.isPending}>
                              저장
                            </Button>
                            <Button size="sm" variant="secondary"
                              onClick={() => { setEditCategory(null); setSelectedStaffId(null); }}>
                              취소
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => { setEditCategory(category); setSelectedStaffId(assignee?.staff_id ?? null); }}
                              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                              title={staff ? '담당자 변경' : '담당자 지정'}>
                              <UserCog size={14} />
                            </button>
                            <button onClick={() => startRename(category)}
                              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                              title="이름 변경">
                              <Type size={14} />
                            </button>
                            {staff && (
                              <button onClick={() => removeMutation.mutate({ category })}
                                disabled={removeMutation.isPending}
                                className="rounded-lg p-1.5 text-zinc-400 hover:bg-orange-50 hover:text-orange-600"
                                title="담당자 해제">
                                <X size={14} />
                              </button>
                            )}
                            <button onClick={() => removeCategory(category)}
                              className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                              title="카테고리 삭제">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium text-zinc-700 mb-3">카테고리 추가</p>
            <div className="flex gap-2">
              <Input type="text" value={newCategory}
                onChange={(e) => setNewCategory(e.currentTarget.value)}
                placeholder="새 카테고리 이름"
                className="flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }}
              />
              <Button onClick={addCategory}
                disabled={!newCategory.trim() || saveCategoriesMutation.isPending}>
                <Plus size={16} /> 추가
              </Button>
            </div>
          </Card>
        </>
      )}

      {(setMutation.error || saveCategoriesMutation.error) && (
        <p className="mt-3 text-sm text-red-600">
          {setMutation.error?.message || saveCategoriesMutation.error?.message}
        </p>
      )}
    </div>
  );
}
