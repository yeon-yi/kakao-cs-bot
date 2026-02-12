'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

const CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

export default function KnowledgeListPage() {
  const [tier, setTier] = useState<number | undefined>();
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ question: '', answer: '', category: '', tier: 1 });

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.knowledge.list.useQuery({
    tier, category: category || undefined, offset, limit,
  });

  const updateMutation = trpc.knowledge.update.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate();
      setEditId(null);
    },
  });

  const deleteMutation = trpc.knowledge.delete.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate();
      setDeleteId(null);
    },
  });

  function startEdit(item: any) {
    setEditId(item.id);
    setEditForm({
      question: item.question,
      answer: item.answer || '',
      category: item.category || '일반',
      tier: item.tier,
    });
  }

  function handleUpdate() {
    if (!editId) return;
    updateMutation.mutate({
      id: editId,
      question: editForm.question,
      answer: editForm.answer,
      category: editForm.category,
      tier: editForm.tier,
    });
  }

  function handleDelete(id: string) {
    deleteMutation.mutate({ id });
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">지식 관리</h1>
        <Link href="/knowledge/add"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          + 지식 추가
        </Link>
      </div>

      <div className="mb-4 flex gap-4">
        <select value={tier ?? ''} onChange={(e) => { setTier(e.currentTarget.value ? Number(e.currentTarget.value) : undefined); setOffset(0); }}
          className="rounded-md border px-3 py-2 text-sm">
          <option value="">전체 Tier</option>
          <option value="1">Tier 1 (공식)</option>
          <option value="2">Tier 2 (학습)</option>
          <option value="3">Tier 3 (대화)</option>
        </select>
        <input type="text" placeholder="카테고리 필터" value={category}
          onChange={(e) => { setCategory(e.currentTarget.value); setOffset(0); }}
          className="rounded-md border px-3 py-2 text-sm" />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">로딩 중...</p>
      ) : (
        <>
          <div className="space-y-3">
            {data?.data.map((item) => (
              <div key={item.id} className="rounded-lg border bg-card p-4">
                {/* Edit mode */}
                {editId === item.id ? (
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <select value={editForm.tier} onChange={(e) => setEditForm({ ...editForm, tier: Number(e.currentTarget.value) })}
                        className="rounded border px-2 py-1.5 text-sm">
                        <option value={1}>Tier 1 (공식)</option>
                        <option value={2}>Tier 2 (학습)</option>
                        <option value={3}>Tier 3 (대화)</option>
                      </select>
                      <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.currentTarget.value })}
                        className="rounded border px-2 py-1.5 text-sm">
                        {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    </div>
                    <input value={editForm.question} onChange={(e) => setEditForm({ ...editForm, question: e.currentTarget.value })}
                      placeholder="질문" className="w-full rounded border px-3 py-2 text-sm" />
                    <textarea value={editForm.answer} onChange={(e) => setEditForm({ ...editForm, answer: e.currentTarget.value })}
                      placeholder="답변" rows={4} className="w-full rounded border px-3 py-2 text-sm" />
                    <div className="flex gap-2">
                      <button onClick={handleUpdate} disabled={updateMutation.isPending}
                        className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                        {updateMutation.isPending ? '저장중...' : '저장'}
                      </button>
                      <button onClick={() => setEditId(null)}
                        className="rounded bg-zinc-200 px-4 py-1.5 text-sm text-zinc-600">취소</button>
                    </div>
                    {updateMutation.error && (
                      <p className="text-sm text-destructive">{updateMutation.error.message}</p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* View mode */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                            item.tier === 1 ? 'bg-blue-100 text-blue-700' :
                            item.tier === 2 ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            Tier {item.tier}
                          </span>
                          {item.category && (
                            <span className="text-xs text-muted-foreground">{item.category}</span>
                          )}
                        </div>
                        <p className="mt-2 font-medium">{item.question}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{item.answer}</p>
                      </div>
                      <div className="ml-4 flex flex-col items-end gap-2">
                        <div className="text-right text-xs text-muted-foreground">
                          <p>사용: {item.usage_count}회</p>
                          <p>확신도: {(item.confidence_score * 100).toFixed(0)}%</p>
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => startEdit(item)}
                            className="rounded border px-2.5 py-1 text-xs hover:bg-muted">수정</button>
                          {deleteId === item.id ? (
                            <div className="flex gap-1">
                              <button onClick={() => handleDelete(item.id)}
                                disabled={deleteMutation.isPending}
                                className="rounded bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50">
                                확인
                              </button>
                              <button onClick={() => setDeleteId(null)}
                                className="rounded bg-zinc-200 px-2.5 py-1 text-xs text-zinc-600">취소</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteId(item.id)}
                              className="rounded px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">삭제</button>
                          )}
                        </div>
                      </div>
                    </div>
                    {item.tags && item.tags.length > 0 && (
                      <div className="mt-2 flex gap-1">
                        {item.tags.map((tag) => (
                          <span key={tag} className="rounded bg-muted px-2 py-0.5 text-xs">{tag}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {(!data?.data || data.data.length === 0) && (
              <p className="py-8 text-center text-muted-foreground">지식이 없습니다</p>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">총 {data?.total ?? 0}건</p>
            <div className="flex gap-2">
              <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50">이전</button>
              <button onClick={() => setOffset(offset + limit)} disabled={(data?.data.length ?? 0) < limit}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50">다음</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
