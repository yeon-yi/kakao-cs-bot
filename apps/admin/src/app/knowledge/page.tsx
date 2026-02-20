'use client';

import { useState, memo } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea, Select } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { PlusCircle, Pencil, Trash2, X, Check } from 'lucide-react';

const CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

const TIER_CONFIG = {
  1: { label: 'Tier 1', desc: '공식', variant: 'primary' as const },
  2: { label: 'Tier 2', desc: '학습', variant: 'success' as const },
  3: { label: 'Tier 3', desc: '대화', variant: 'default' as const },
};

const KnowledgeItem = memo(function KnowledgeItem({
  item, editId, editForm, setEditForm, setEditId, startEdit, handleUpdate, handleDelete,
  deleteId, setDeleteId, updateMutation, deleteMutation,
}: any) {
  const tier = TIER_CONFIG[item.tier as keyof typeof TIER_CONFIG] || TIER_CONFIG[1];

  if (editId === item.id) {
    return (
      <Card className="space-y-3">
        <div className="flex gap-3">
          <Select value={editForm.tier} onChange={(e: any) => setEditForm({ ...editForm, tier: Number(e.currentTarget.value) })}>
            <option value={1}>Tier 1 (공식)</option>
            <option value={2}>Tier 2 (학습)</option>
            <option value={3}>Tier 3 (대화)</option>
          </Select>
          <Select value={editForm.category} onChange={(e: any) => setEditForm({ ...editForm, category: e.currentTarget.value })}>
            {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </Select>
        </div>
        <Input value={editForm.question} onChange={(e: any) => setEditForm({ ...editForm, question: e.currentTarget.value })} placeholder="질문" />
        <Textarea value={editForm.answer} onChange={(e: any) => setEditForm({ ...editForm, answer: e.currentTarget.value })} placeholder="답변" rows={4} />
        <div className="flex gap-2">
          <Button onClick={handleUpdate} disabled={updateMutation.isPending} size="sm">
            <Check size={14} />
            {updateMutation.isPending ? '저장중...' : '저장'}
          </Button>
          <Button onClick={() => setEditId(null)} variant="secondary" size="sm">
            <X size={14} />
            취소
          </Button>
        </div>
        {updateMutation.error && <p className="text-sm text-red-600">{updateMutation.error.message}</p>}
      </Card>
    );
  }

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tier.variant}>{tier.label}</Badge>
            {item.category && <Badge variant="outline">{item.category}</Badge>}
          </div>
          <p className="mt-2.5 font-medium text-zinc-900">{item.question}</p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-500">{item.answer}</p>
          {item.tags && item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.tags.map((tag: string) => (
                <span key={tag} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">{tag}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="text-right text-xs text-zinc-400">
            <p>사용 {item.usage_count}회</p>
            <p>확신 {(item.confidence_score * 100).toFixed(0)}%</p>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => startEdit(item)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
              <Pencil size={14} />
            </button>
            {deleteId === item.id ? (
              <div className="flex gap-1">
                <Button onClick={() => handleDelete(item.id)} disabled={deleteMutation.isPending} variant="destructive" size="sm">
                  확인
                </Button>
                <Button onClick={() => setDeleteId(null)} variant="secondary" size="sm">취소</Button>
              </div>
            ) : (
              <button onClick={() => setDeleteId(item.id)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
});

export default function KnowledgeListPage() {
  const [tier, setTier] = useState<number | undefined>();
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ question: '', answer: '', category: '', tier: 1 });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.knowledge.list.useQuery({
    tier, category: category || undefined, offset, limit,
  });

  const updateMutation = trpc.knowledge.update.useMutation({
    onSuccess: () => { utils.knowledge.list.invalidate(); setEditId(null); },
  });

  const deleteMutation = trpc.knowledge.delete.useMutation({
    onSuccess: () => { utils.knowledge.list.invalidate(); setDeleteId(null); },
  });

  function startEdit(item: any) {
    setEditId(item.id);
    setEditForm({ question: item.question, answer: item.answer || '', category: item.category || '일반', tier: item.tier });
  }

  function handleUpdate() {
    if (!editId) return;
    updateMutation.mutate({ id: editId, ...editForm });
  }

  function handleDelete(id: string) {
    deleteMutation.mutate({ id });
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">지식 관리</h1>
          <p className="mt-1 text-sm text-zinc-500">총 {data?.total ?? 0}건의 지식이 등록되어 있습니다</p>
        </div>
        <Link href="/knowledge/add">
          <Button><PlusCircle size={16} />지식 추가</Button>
        </Link>
      </div>

      <div className="mb-4 flex gap-3">
        <Select value={tier ?? ''} onChange={(e) => { setTier(e.currentTarget.value ? Number(e.currentTarget.value) : undefined); setOffset(0); }}
          className="w-40">
          <option value="">전체 Tier</option>
          <option value="1">Tier 1 (공식)</option>
          <option value="2">Tier 2 (학습)</option>
          <option value="3">Tier 3 (대화)</option>
        </Select>
        <Select value={category} onChange={(e) => { setCategory(e.currentTarget.value); setOffset(0); }}
          className="w-40">
          <option value="">전체 카테고리</option>
          {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {data?.data.map((item) => (
              <KnowledgeItem
                key={item.id} item={item} editId={editId} editForm={editForm} setEditForm={setEditForm}
                setEditId={setEditId} startEdit={startEdit} handleUpdate={handleUpdate} handleDelete={handleDelete}
                deleteId={deleteId} setDeleteId={setDeleteId} updateMutation={updateMutation} deleteMutation={deleteMutation}
              />
            ))}
            {(!data?.data || data.data.length === 0) && (
              <div className="py-16 text-center text-zinc-400">등록된 지식이 없습니다</div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-zinc-400">총 {data?.total ?? 0}건</p>
            <div className="flex gap-2">
              <Button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} variant="outline" size="sm">이전</Button>
              <Button onClick={() => setOffset(offset + limit)} disabled={(data?.data.length ?? 0) < limit} variant="outline" size="sm">다음</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
