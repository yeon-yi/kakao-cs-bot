'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select, FormField } from '@/components/ui/input';
import { Save } from 'lucide-react';

const CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

export interface KnowledgeAddFormProps {
  initialQuestion?: string;
  initialAnswer?: string;
  initialCategory?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function KnowledgeAddForm({
  initialQuestion,
  initialAnswer,
  initialCategory,
  onSuccess,
  onCancel,
}: KnowledgeAddFormProps) {
  const [form, setForm] = useState({
    question: initialQuestion ?? '',
    answer: initialAnswer ?? '',
    category: initialCategory ?? '',
    tier: 1,
    tags: '',
    notes: '',
  });

  const utils = trpc.useUtils();
  const addMutation = trpc.knowledge.add.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate();
      onSuccess?.();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.question.length < 5) return;
    if (form.answer.length < 10) return;
    if (!form.category) return;

    addMutation.mutate({
      question: form.question,
      answer: form.answer,
      category: form.category,
      tier: form.tier,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      notes: form.notes || undefined,
    });
  };

  const set = (key: string, value: string | number) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {addMutation.error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {addMutation.error.message}
        </div>
      )}

      <FormField
        label="질문"
        required
        hint="광고주가 실제로 물어볼 만한 질문을 자연스럽게 입력하세요 (최소 5자)"
      >
        <Textarea
          value={form.question}
          onChange={(e) => set('question', e.currentTarget.value)}
          rows={2}
          placeholder="예: 블로그 기자단 진행하면 효과가 얼마나 나오나요?"
          required
          minLength={5}
        />
      </FormField>

      <FormField label="답변" required hint="정확하고 구체적인 답변을 입력하세요 (최소 10자)">
        <Textarea
          value={form.answer}
          onChange={(e) => set('answer', e.currentTarget.value)}
          rows={5}
          placeholder="답변 내용을 상세하게 입력하세요"
          required
          minLength={10}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="카테고리" required>
          <Select
            value={form.category}
            onChange={(e) => set('category', e.currentTarget.value)}
            required
          >
            <option value="">선택하세요</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Tier" hint="공식 자료일수록 높은 우선순위">
          <Select
            value={form.tier}
            onChange={(e) => set('tier', Number(e.currentTarget.value))}
          >
            <option value={1}>Tier 1 - 공식 자료</option>
            <option value={2}>Tier 2 - 학습된 지식</option>
            <option value={3}>Tier 3 - 대화 패턴</option>
          </Select>
        </FormField>
      </div>

      <FormField label="태그" hint="검색 정확도를 높이기 위한 키워드 (쉼표로 구분)">
        <Input
          type="text"
          value={form.tags}
          onChange={(e) => set('tags', e.currentTarget.value)}
          placeholder="예: 블로그, 기자단, 리뷰, 포스팅"
        />
      </FormField>

      <FormField label="메모" hint="관리용 메모 (봇 답변에는 포함되지 않음)">
        <Textarea
          value={form.notes}
          onChange={(e) => set('notes', e.currentTarget.value)}
          rows={2}
        />
      </FormField>

      <div className="flex gap-2 border-t border-zinc-100 pt-5">
        <Button type="submit" disabled={addMutation.isPending} size="sm">
          <Save size={14} />
          {addMutation.isPending ? '저장 중...' : '저장'}
        </Button>
        <Button type="button" onClick={() => onCancel?.()} variant="secondary" size="sm">
          취소
        </Button>
      </div>
    </form>
  );
}
