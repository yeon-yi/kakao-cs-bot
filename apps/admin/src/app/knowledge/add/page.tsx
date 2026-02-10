'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

export default function AddKnowledgePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    question: '', answer: '', category: '', tier: 2, tags: '', notes: '',
  });

  const utils = trpc.useUtils();
  const addMutation = trpc.knowledge.add.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate();
      router.push('/knowledge');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({
      question: form.question,
      answer: form.answer,
      category: form.category,
      tier: form.tier,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()) : undefined,
      notes: form.notes || undefined,
    });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">지식 추가</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {addMutation.error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {addMutation.error.message}
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">질문 *</label>
          <textarea value={form.question} onChange={(e) => setForm({ ...form, question: e.currentTarget.value })}
            className="w-full rounded-md border px-3 py-2 text-sm" rows={2}
            placeholder="광고주가 물어볼 질문을 입력하세요" required minLength={5} />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">답변 *</label>
          <textarea value={form.answer} onChange={(e) => setForm({ ...form, answer: e.currentTarget.value })}
            className="w-full rounded-md border px-3 py-2 text-sm" rows={6}
            placeholder="답변 내용을 입력하세요" required minLength={10} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">카테고리 *</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.currentTarget.value })}
              className="w-full rounded-md border px-3 py-2 text-sm" required>
              <option value="">선택</option>
              <option value="정산">정산</option>
              <option value="계약">계약</option>
              <option value="시스템">시스템 사용</option>
              <option value="기타">기타</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Tier</label>
            <select value={form.tier} onChange={(e) => setForm({ ...form, tier: Number(e.currentTarget.value) })}
              className="w-full rounded-md border px-3 py-2 text-sm">
              <option value={1}>Tier 1 (공식 자료)</option>
              <option value={2}>Tier 2 (학습된 지식)</option>
              <option value={3}>Tier 3 (대화 패턴)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">태그 (쉼표 구분)</label>
          <input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.currentTarget.value })}
            className="w-full rounded-md border px-3 py-2 text-sm" placeholder="정산, 입금, FAQ" />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">메모</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })}
            className="w-full rounded-md border px-3 py-2 text-sm" rows={2} />
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={addMutation.isPending}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {addMutation.isPending ? '저장 중...' : '저장'}
          </button>
          <button type="button" onClick={() => router.back()}
            className="rounded-md border px-6 py-2 text-sm hover:bg-accent">
            취소
          </button>
        </div>
      </form>
    </div>
  );
}
