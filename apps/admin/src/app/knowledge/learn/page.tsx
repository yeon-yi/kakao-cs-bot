'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  GraduationCap, Search, Plus, Check, Edit2, X,
  MessageSquare, Sparkles, BookOpen, Calendar,
} from 'lucide-react';

interface QAItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  confidence: number;
}

interface TonePattern {
  pattern: string;
  count: number;
  example: string;
}

export default function LearnPage() {
  const [conversationText, setConversationText] = useState('');
  const [activeTab, setActiveTab] = useState<'qa' | 'tone'>('qa');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ question: string; answer: string; category: string }>({
    question: '', answer: '', category: '',
  });

  // Parsed results stored locally after mutation
  const [qaResults, setQaResults] = useState<QAItem[]>([]);
  const [tonePatterns, setTonePatterns] = useState<TonePattern[]>([]);
  const [toneSummary, setToneSummary] = useState('');
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const parseMutation = trpc.learning.parseConversation.useMutation({
    onSuccess: (data: any) => {
      // Backend returns { pairs, toneProfile }
      const pairs = (data.pairs || []).map((p: any, i: number) => ({
        id: `qa-${i}`,
        question: p.question,
        answer: p.answer,
        category: p.category || '일반문의',
        confidence: p.confidence || 0.5,
      }));
      setQaResults(pairs);

      const tp = data.toneProfile || {};
      setTonePatterns(
        (tp.patterns || []).map((pat: string, i: number) => ({
          pattern: pat,
          count: 1,
          example: (tp.examples || [])[i] || '',
        }))
      );
      setToneSummary(tp.style || '');
      setHasAnalyzed(true);
      setActiveTab('qa');
      setSelectedItems(new Set());
    },
  });

  const applyMutation = trpc.learning.applyLearning.useMutation({
    onSuccess: () => {
      setSelectedItems(new Set());
      toneProfileQuery.refetch();
    },
  });

  const toneProfileQuery = trpc.learning.getToneProfile.useQuery();
  const toneProfile = toneProfileQuery.data;

  const handleAnalyze = () => {
    if (!conversationText.trim()) return;
    parseMutation.mutate({ text: conversationText });
  };

  const toggleItem = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === qaResults.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(qaResults.map(q => q.id)));
    }
  };

  const startEdit = (item: QAItem) => {
    setEditingId(item.id);
    setEditValues({ question: item.question, answer: item.answer, category: item.category });
  };

  const saveEdit = () => {
    if (!editingId) return;
    setQaResults(prev => prev.map(item =>
      item.id === editingId
        ? { ...item, question: editValues.question, answer: editValues.answer, category: editValues.category }
        : item
    ));
    setEditingId(null);
  };

  const handleAddToKnowledge = () => {
    const items = qaResults.filter(q => selectedItems.has(q.id));
    if (items.length === 0) return;
    applyMutation.mutate({
      pairs: items.map(({ question, answer, category }) => ({ question, answer, category })),
    });
  };

  const handleApplyTone = () => {
    applyMutation.mutate({
      pairs: [],
      tonePatterns: tonePatterns.map(tp => tp.pattern),
    });
  };

  const confidenceColor = (c: number) => {
    if (c >= 0.8) return 'text-emerald-600';
    if (c >= 0.5) return 'text-amber-600';
    return 'text-red-500';
  };

  return (
    <div className="max-w-[960px]">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-[hsl(var(--foreground))]">대화 학습</h1>
        <p className="mt-0.5 text-xs text-[hsl(var(--muted))]">
          실제 카카오톡 대화를 분석하여 Q&A 지식과 말투를 학습합니다
        </p>
      </div>

      {/* Section 1: 대화 붙여넣기 */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-white shadow-sm mb-6">
        <div className="px-5 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-[hsl(var(--primary))]" />
            <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">대화 붙여넣기</h2>
          </div>
        </div>
        <div className="p-5">
          <textarea
            value={conversationText}
            onChange={(e) => setConversationText(e.target.value)}
            placeholder="카카오톡 대화를 복사하여 붙여넣으세요...

예시:
[고객] 배송 언제 되나요?
[상담원] 안녕하세요, 고객님. 주문하신 상품은 내일 출발 예정입니다.
[고객] 감사합니다
[상담원] 네, 감사합니다. 추가 문의사항 있으시면 말씀해주세요."
            className="w-full min-h-[280px] rounded-md border border-[hsl(var(--input))] bg-white px-3 py-3 text-sm text-[hsl(var(--foreground))] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/20 focus:border-[hsl(var(--ring))] resize-y"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-[hsl(var(--muted))]">
              {conversationText.length > 0 ? `${conversationText.split('\n').filter(l => l.trim()).length}줄` : ''}
            </span>
            <Button
              onClick={handleAnalyze}
              disabled={!conversationText.trim() || parseMutation.isPending}
            >
              <Search size={14} />
              {parseMutation.isPending ? '분석 중...' : '분석하기'}
            </Button>
          </div>
        </div>
      </div>

      {/* Section 2: 분석 결과 */}
      {hasAnalyzed && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-white shadow-sm mb-6">
          <div className="px-5 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-[hsl(var(--accent))]" />
              <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">분석 결과</h2>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab('qa')}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                  activeTab === 'qa'
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : 'text-[hsl(var(--muted))] hover:bg-[hsl(var(--secondary))]'
                )}
              >
                추출된 Q&A ({qaResults.length})
              </button>
              <button
                onClick={() => setActiveTab('tone')}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                  activeTab === 'tone'
                    ? 'bg-[hsl(var(--primary))] text-white'
                    : 'text-[hsl(var(--muted))] hover:bg-[hsl(var(--secondary))]'
                )}
              >
                말투 분석
              </button>
            </div>
          </div>

          {/* Q&A Tab */}
          {activeTab === 'qa' && (
            <div className="p-5">
              {qaResults.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted))] text-center py-8">추출된 Q&A 항목이 없습니다.</p>
              ) : (
                <>
                  {/* Table header */}
                  <div className="mb-3 flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted))] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedItems.size === qaResults.length && qaResults.length > 0}
                        onChange={toggleAll}
                        className="rounded border-slate-300"
                      />
                      전체 선택 ({selectedItems.size}/{qaResults.length})
                    </label>
                    <Button
                      size="sm"
                      disabled={selectedItems.size === 0 || applyMutation.isPending}
                      onClick={handleAddToKnowledge}
                    >
                      <Plus size={13} />
                      {applyMutation.isPending ? '추가 중...' : '선택한 항목 지식에 추가'}
                    </Button>
                  </div>

                  {/* Table */}
                  <div className="border border-[hsl(var(--border))] rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[hsl(var(--secondary))]">
                          <th className="w-9 px-3 py-2 text-left"></th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted))]">질문</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted))]">답변</th>
                          <th className="w-24 px-3 py-2 text-left text-xs font-medium text-[hsl(var(--muted))]">카테고리</th>
                          <th className="w-16 px-3 py-2 text-center text-xs font-medium text-[hsl(var(--muted))]">신뢰도</th>
                          <th className="w-12 px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[hsl(var(--border))]">
                        {qaResults.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2.5">
                              <input
                                type="checkbox"
                                checked={selectedItems.has(item.id)}
                                onChange={() => toggleItem(item.id)}
                                className="rounded border-slate-300"
                              />
                            </td>
                            {editingId === item.id ? (
                              <>
                                <td className="px-3 py-2">
                                  <input
                                    value={editValues.question}
                                    onChange={(e) => setEditValues(v => ({ ...v, question: e.target.value }))}
                                    className="w-full rounded border border-[hsl(var(--input))] px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    value={editValues.answer}
                                    onChange={(e) => setEditValues(v => ({ ...v, answer: e.target.value }))}
                                    className="w-full rounded border border-[hsl(var(--input))] px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    value={editValues.category}
                                    onChange={(e) => setEditValues(v => ({ ...v, category: e.target.value }))}
                                    className="w-full rounded border border-[hsl(var(--input))] px-2 py-1 text-xs"
                                  />
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={cn('text-xs font-medium', confidenceColor(item.confidence))}>
                                    {Math.round(item.confidence * 100)}%
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex gap-1">
                                    <button onClick={saveEdit} className="text-emerald-600 hover:text-emerald-700">
                                      <Check size={13} />
                                    </button>
                                    <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600">
                                      <X size={13} />
                                    </button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2.5 text-xs text-[hsl(var(--foreground))]">{item.question}</td>
                                <td className="px-3 py-2.5 text-xs text-[hsl(var(--muted))]">{item.answer}</td>
                                <td className="px-3 py-2.5">
                                  <Badge variant="default">{item.category}</Badge>
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <span className={cn('text-xs font-medium', confidenceColor(item.confidence))}>
                                    {Math.round(item.confidence * 100)}%
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <button onClick={() => startEdit(item)} className="text-slate-400 hover:text-[hsl(var(--primary))]">
                                    <Edit2 size={13} />
                                  </button>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tone Tab */}
          {activeTab === 'tone' && (
            <div className="p-5">
              {toneSummary && (
                <div className="mb-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3">
                  <p className="text-xs font-medium text-[hsl(var(--foreground))] mb-1">말투 요약</p>
                  <p className="text-sm text-[hsl(var(--muted))]">{toneSummary}</p>
                </div>
              )}

              {tonePatterns.length > 0 ? (
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-medium text-[hsl(var(--foreground))]">감지된 패턴</p>
                  {tonePatterns.map((tp, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-md border border-[hsl(var(--border))] px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[hsl(var(--foreground))]">{tp.pattern}</span>
                          <Badge variant="outline">{tp.count}회</Badge>
                        </div>
                        <p className="mt-1 text-xs text-[hsl(var(--muted))]">예: &ldquo;{tp.example}&rdquo;</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[hsl(var(--muted))] text-center py-8">감지된 말투 패턴이 없습니다.</p>
              )}

              {tonePatterns.length > 0 && (
                <div className="flex justify-end">
                  <Button onClick={handleApplyTone} disabled={applyMutation.isPending}>
                    <Sparkles size={14} />
                    {applyMutation.isPending ? '적용 중...' : '말투 학습 적용'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Section 3: 학습 현황 */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-white shadow-sm">
        <div className="px-5 py-3 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-[hsl(var(--primary))]" />
            <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">학습 현황</h2>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-md border border-[hsl(var(--border))] px-4 py-3">
              <p className="text-xs text-[hsl(var(--muted))]">지식 항목 수</p>
              <p className="mt-1 text-xl font-bold text-[hsl(var(--foreground))]">-</p>
            </div>
            <div className="rounded-md border border-[hsl(var(--border))] px-4 py-3">
              <p className="text-xs text-[hsl(var(--muted))]">최근 학습일</p>
              <p className="mt-1 text-sm font-medium text-[hsl(var(--foreground))] flex items-center gap-1.5">
                <Calendar size={13} className="text-[hsl(var(--muted))]" />
                {toneProfile?.updatedAt
                  ? new Date(toneProfile.updatedAt).toLocaleDateString('ko-KR')
                  : '-'}
              </p>
            </div>
            <div className="rounded-md border border-[hsl(var(--border))] px-4 py-3">
              <p className="text-xs text-[hsl(var(--muted))]">학습된 말투 패턴</p>
              <p className="mt-1 text-xl font-bold text-[hsl(var(--foreground))]">
                {toneProfile?.patterns?.length ?? 0}
                <span className="ml-1 text-xs font-normal text-[hsl(var(--muted))]">개</span>
              </p>
            </div>
          </div>

          {toneProfile?.patterns && toneProfile.patterns.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-[hsl(var(--foreground))] mb-2">적용 중인 말투 패턴</p>
              <div className="flex flex-wrap gap-1.5">
                {toneProfile.patterns.map((p: string, i: number) => (
                  <Badge key={i} variant="primary">{p}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
