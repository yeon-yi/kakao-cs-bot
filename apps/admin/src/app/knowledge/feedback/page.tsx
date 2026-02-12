'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const STATUS_TABS = [
  { value: undefined, label: '전체' },
  { value: 'pending' as const, label: '대기중' },
  { value: 'assigned' as const, label: '배정됨' },
  { value: 'answered' as const, label: '답변됨' },
  { value: 'learned' as const, label: '학습완료' },
  { value: 'dismissed' as const, label: '무시' },
];

const CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '대기중' },
    assigned: { bg: 'bg-blue-100', text: 'text-blue-800', label: '배정됨' },
    answered: { bg: 'bg-green-100', text: 'text-green-800', label: '답변됨' },
    learned: { bg: 'bg-purple-100', text: 'text-purple-800', label: '학습완료' },
    dismissed: { bg: 'bg-gray-100', text: 'text-gray-600', label: '무시' },
  };
  const s = map[status] || map.pending;
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>{s.label}</span>;
}

export default function EscalationPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [answerCategory, setAnswerCategory] = useState('');
  const limit = 20;

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.escalation.list.useQuery({
    status: statusFilter as any,
    offset,
    limit,
  });

  const { data: pendingData } = trpc.escalation.pendingCount.useQuery();

  const answerMutation = trpc.escalation.answer.useMutation({
    onSuccess: () => {
      utils.escalation.list.invalidate();
      utils.escalation.pendingCount.invalidate();
      setSelectedId(null);
      setAnswerText('');
      setAnswerCategory('');
    },
  });

  const dismissMutation = trpc.escalation.dismiss.useMutation({
    onSuccess: () => {
      utils.escalation.list.invalidate();
      utils.escalation.pendingCount.invalidate();
    },
  });

  function handleAnswer(id: number) {
    if (!answerText.trim()) return;
    answerMutation.mutate({
      id,
      answer: answerText,
      category: answerCategory || undefined,
    });
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">에스컬레이션</h1>
        {pendingData && pendingData.count > 0 && (
          <span className="px-3 py-1 bg-red-500 text-white text-sm font-medium rounded-full">
            {pendingData.count}건 대기중
          </span>
        )}
      </div>
      <p className="text-muted-foreground text-sm mb-6">
        봇이 답변하지 못한 질문을 확인하고, 답변을 등록하면 자동으로 학습 + 카카오톡 회신됩니다.
      </p>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 border-b">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => { setStatusFilter(tab.value); setOffset(0); }}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              statusFilter === tab.value
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">로딩 중...</p>
      ) : !data?.data || data.data.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border rounded-lg">
          <p className="text-lg mb-2">에스컬레이션이 없습니다.</p>
          <p className="text-sm">봇이 답변하지 못한 질문이 발생하면 여기에 표시됩니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.data.map((item) => (
            <div key={item.id} className="border rounded-lg p-4 bg-card">
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{item.user_message}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {statusBadge(item.status)}
                    {item.category && (
                      <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 text-xs">{item.category}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {item.user_name || item.user_id} · {item.room_id}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString('ko-KR')}
                    </span>
                    {item.confidence !== null && (
                      <span className="text-xs text-muted-foreground">
                        유사도: {Math.round((item.confidence ?? 0) * 100)}%
                      </span>
                    )}
                  </div>
                  {item.bot_response && (
                    <p className="text-sm text-muted-foreground mt-2 pl-3 border-l-2 border-zinc-200">
                      봇: {item.bot_response}
                    </p>
                  )}
                  {item.answer && (
                    <p className="text-sm text-green-700 mt-2 pl-3 border-l-2 border-green-300">
                      답변: {item.answer}
                    </p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {(item.status === 'pending' || item.status === 'assigned') && (
                    <>
                      <button
                        onClick={() => {
                          setSelectedId(selectedId === item.id ? null : item.id);
                          setAnswerText('');
                          setAnswerCategory(item.category || '일반');
                        }}
                        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                      >
                        답변하기
                      </button>
                      <button
                        onClick={() => dismissMutation.mutate({ id: item.id })}
                        disabled={dismissMutation.isPending}
                        className="px-3 py-1.5 bg-zinc-200 text-zinc-600 text-sm rounded hover:bg-zinc-300"
                      >
                        무시
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Inline answer form */}
              {selectedId === item.id && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <textarea
                    value={answerText}
                    onChange={(e) => setAnswerText(e.currentTarget.value)}
                    placeholder="이 질문에 대한 올바른 답변을 입력하세요..."
                    rows={3}
                    className="w-full p-2 border rounded text-sm"
                    autoFocus
                  />
                  <div className="flex gap-2 items-center">
                    <select
                      value={answerCategory}
                      onChange={(e) => setAnswerCategory(e.currentTarget.value)}
                      className="p-2 border rounded text-sm"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleAnswer(item.id)}
                      disabled={answerMutation.isPending || !answerText.trim()}
                      className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {answerMutation.isPending ? '처리중...' : '답변 등록 + 학습'}
                    </button>
                    <button
                      onClick={() => setSelectedId(null)}
                      className="px-4 py-2 bg-zinc-200 text-zinc-600 text-sm rounded"
                    >
                      취소
                    </button>
                  </div>
                  {answerMutation.error && (
                    <p className="text-sm text-destructive">{answerMutation.error.message}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > limit && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">총 {data.total}건</p>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-3 py-1.5 border rounded text-sm disabled:opacity-50"
            >
              이전
            </button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={data.data.length < limit}
              className="px-3 py-1.5 border rounded text-sm disabled:opacity-50"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
