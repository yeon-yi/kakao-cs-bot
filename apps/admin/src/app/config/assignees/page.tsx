'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { UserCog, Plus, Trash2, Check, X, Type, Users, Hash } from 'lucide-react';

const DEFAULT_CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

export default function AssigneesPage() {
  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [selectedStaffIds, setSelectedStaffIds] = useState<number[]>([]);
  const [addRoomId, setAddRoomId] = useState('');
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

  const addMutation = trpc.escalation.assignees.add.useMutation({
    onSuccess: () => utils.escalation.assignees.list.invalidate(),
  });

  const removeByIdMutation = trpc.escalation.assignees.removeById.useMutation({
    onSuccess: () => utils.escalation.assignees.list.invalidate(),
  });

  const removeCategoryMutation = trpc.escalation.assignees.remove.useMutation({
    onSuccess: () => utils.escalation.assignees.list.invalidate(),
  });

  const saveCategoriesMutation = trpc.config.update.useMutation({
    onSuccess: () => utils.config.get.invalidate({ key: 'escalation.categories' }),
  });

  // 카테고리별 담당자 그룹핑
  const assigneesByCategory = new Map<string, any[]>();
  assignees?.forEach((a: any) => {
    const list = assigneesByCategory.get(a.category) || [];
    list.push(a);
    assigneesByCategory.set(a.category, list);
  });

  function handleAddAssignees(category: string) {
    if (selectedStaffIds.length === 0) return;
    const roomId = addRoomId.trim() || undefined;
    Promise.all(
      selectedStaffIds.map(staffId =>
        addMutation.mutateAsync({ category, staffId, roomId })
      )
    ).then(() => {
      setAddingCategory(null);
      setSelectedStaffIds([]);
      setAddRoomId('');
    });
  }

  function toggleStaff(staffId: number) {
    setSelectedStaffIds(prev =>
      prev.includes(staffId) ? prev.filter(id => id !== staffId) : [...prev, staffId]
    );
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
    removeCategoryMutation.mutate({ category: cat });
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
    setRenamingCategory(null);
  }

  const isLoading = assigneesLoading || staffLoading;
  const assignedCount = categories.filter(c => assigneesByCategory.has(c)).length;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">담당자 배정</h1>
            <p className="text-sm text-zinc-500 mt-1">
              카테고리별로 다중 담당자를 배정합니다. 톡방별로 다른 담당자를 지정할 수도 있습니다.
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
          <div className="space-y-3 mb-5">
            {categories.map((category) => {
              const catAssignees = assigneesByCategory.get(category) || [];
              const isAdding = addingCategory === category;
              const isRenaming = renamingCategory === category;

              // 톡방별 그룹핑
              const globalAssignees = catAssignees.filter((a: any) => !a.room_id);
              const roomGroups = new Map<string, any[]>();
              catAssignees.filter((a: any) => a.room_id).forEach((a: any) => {
                const list = roomGroups.get(a.room_id) || [];
                list.push(a);
                roomGroups.set(a.room_id, list);
              });

              return (
                <Card key={category} className="p-4">
                  {/* 카테고리 헤더 */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {isRenaming ? (
                        <div className="flex gap-1.5 items-center">
                          <Input type="text" value={renameValue}
                            onChange={(e) => setRenameValue(e.currentTarget.value)}
                            className="w-40 text-sm" autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmRename(category);
                              if (e.key === 'Escape') setRenamingCategory(null);
                            }}
                          />
                          <button onClick={() => confirmRename(category)}
                            className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-50">
                            <Check size={14} />
                          </button>
                          <button onClick={() => setRenamingCategory(null)}
                            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <span className="font-semibold text-zinc-900 cursor-pointer hover:text-blue-600"
                          onDoubleClick={() => startRename(category)} title="더블클릭하여 이름 변경">
                          {category}
                        </span>
                      )}
                      {catAssignees.length > 0 && (
                        <Badge variant="primary" className="text-[10px]">
                          {catAssignees.length}명
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => {
                        setAddingCategory(isAdding ? null : category);
                        setSelectedStaffIds([]);
                        setAddRoomId('');
                      }}
                        className={cn(
                          'rounded-lg p-1.5 transition-colors',
                          isAdding ? 'bg-blue-50 text-blue-600' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'
                        )}
                        title="담당자 추가">
                        <UserCog size={14} />
                      </button>
                      <button onClick={() => startRename(category)}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                        title="이름 변경">
                        <Type size={14} />
                      </button>
                      <button onClick={() => removeCategory(category)}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        title="카테고리 삭제">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* 담당자 목록 */}
                  {catAssignees.length === 0 && !isAdding && (
                    <p className="text-xs text-zinc-300 py-1">미지정</p>
                  )}

                  {/* 전체 담당자 */}
                  {globalAssignees.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {globalAssignees.map((a: any) => (
                        <span key={a.id}
                          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                          <Users size={11} />
                          {a.company_staff.real_name}
                          {a.company_staff.department && (
                            <span className="text-blue-400">({a.company_staff.department})</span>
                          )}
                          <button onClick={() => removeByIdMutation.mutate({ id: a.id })}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-blue-200/60" title="제거">
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 톡방별 담당자 */}
                  {Array.from(roomGroups.entries()).map(([roomId, roomAssignees]) => (
                    <div key={roomId} className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 font-medium">
                        <Hash size={10} /> {roomId}
                      </span>
                      {roomAssignees.map((a: any) => (
                        <span key={a.id}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                          {a.company_staff.real_name}
                          <button onClick={() => removeByIdMutation.mutate({ id: a.id })}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-200/60" title="제거">
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ))}

                  {/* 담당자 추가 UI */}
                  {isAdding && (
                    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/30 p-3">
                      <p className="text-xs font-medium text-zinc-600 mb-2">담당자 선택 (복수 선택 가능)</p>
                      <div className="flex flex-wrap gap-1.5 mb-3 max-h-40 overflow-y-auto">
                        {staffList?.map((s) => {
                          const selected = selectedStaffIds.includes(s.id);
                          const alreadyAssigned = catAssignees.some(
                            (a: any) => a.staff_id === s.id && !a.room_id && !addRoomId.trim()
                          );
                          return (
                            <button key={s.id}
                              onClick={() => !alreadyAssigned && toggleStaff(s.id)}
                              disabled={alreadyAssigned}
                              className={cn(
                                'rounded-lg border px-3 py-1.5 text-xs transition-all',
                                selected
                                  ? 'border-blue-400 bg-blue-100 text-blue-700 font-medium'
                                  : alreadyAssigned
                                    ? 'border-zinc-100 bg-zinc-50 text-zinc-300 cursor-not-allowed'
                                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-blue-300 hover:bg-blue-50'
                              )}>
                              {selected && <Check size={11} className="inline mr-1" />}
                              {s.real_name}
                              {s.department && <span className="text-zinc-400 ml-1">({s.department})</span>}
                              {alreadyAssigned && <span className="ml-1 text-zinc-300">배정됨</span>}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="text" value={addRoomId}
                          onChange={(e) => setAddRoomId(e.currentTarget.value)}
                          placeholder="톡방 ID (비우면 전체 적용)"
                          className="flex-1 text-xs h-8"
                        />
                        <Button size="sm" onClick={() => handleAddAssignees(category)}
                          disabled={selectedStaffIds.length === 0 || addMutation.isPending}>
                          <Plus size={14} /> {selectedStaffIds.length}명 추가
                        </Button>
                        <Button size="sm" variant="secondary"
                          onClick={() => { setAddingCategory(null); setSelectedStaffIds([]); setAddRoomId(''); }}>
                          취소
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {/* 카테고리 추가 */}
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

      {(addMutation.error || saveCategoriesMutation.error) && (
        <p className="mt-3 text-sm text-red-600">
          {addMutation.error?.message || saveCategoriesMutation.error?.message}
        </p>
      )}
    </div>
  );
}
