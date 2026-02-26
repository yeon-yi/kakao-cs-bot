'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, X, TrendingUp } from 'lucide-react';

const STATUS_TABS = [
  { value: 'open', label: '미해결' },
  { value: 'addressed', label: '해결됨' },
  { value: 'dismissed', label: '무시' },
];

const SOURCE_LABEL: Record<string, string> = {
  low_similarity: '낮은 유사도',
  hedging: '불확실 응답',
  new_topic: '신규 주제',
  repeated_escalation: '반복 에스컬',
  confidence_decay: '신뢰도 하락',
};

export default function UncertaintyPage() {
  const [statusFilter, setStatusFilter] = useState('open');
  const [offset, setOffset] = useState(0);
  const [answeringId, setAnsweringId] = useState<number | null>(null);
  const [answerQuestion, setAnswerQuestion] = useState('');
  const [answerText, setAnswerText] = useState('');
  const limit = 20;

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.uncertainty.list.useQuery({ status: statusFilter, offset, limit });
  const { data: stats } = trpc.uncertainty.stats.useQuery();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const resolveMutation = trpc.uncertainty.resolve.useMutation({
    onSuccess: () => {
      utils.uncertainty.list.invalidate();
      utils.uncertainty.stats.invalidate();
      utils.uncertainty.openCount.invalidate();
      setAnsweringId(null);
      setAnswerText('');
      setAnswerQuestion('');
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(`지식 등록 실패: ${err.message}`),
  });

  const dismissMutation = trpc.uncertainty.dismiss.useMutation({
    onSuccess: () => {
      utils.uncertainty.list.invalidate();
      utils.uncertainty.stats.invalidate();
      utils.uncertainty.openCount.invalidate();
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(`무시 처리 실패: ${err.message}`),
  });

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">불확실 주제</h1>
        <p className="mt-1 text-sm text-zinc-500">
          AI가 확신하지 못하는 주제를 실시간으로 추적합니다. 답변을 등록하면 지식 DB에 추가됩니다.
        </p>
      </div>

      {/* 통계 카드 */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card className="p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{stats.open || 0}</p>
            <p className="text-xs text-zinc-500">미해결</p>
          </Card>
          <Card className="p-3 text-center">
            <p className="text-2xl font-bold text-emerald-600">{stats.addressed || 0}</p>
            <p className="text-xs text-zinc-500">해결됨</p>
          </Card>
          <Card className="p-3 text-center">
            <p className="text-2xl font-bold text-zinc-400">{stats.dismissed || 0}</p>
            <p className="text-xs text-zinc-500">무시</p>
          </Card>
        </div>
      )}

      {errorMsg && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex justify-between items-center">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600 ml-3">&times;</button>
        </div>
      )}

      {/* 상태 탭 */}
      <div className="flex gap-1 mb-5 border-b border-zinc-200">
        {STATUS_TABS.map((tab) => (
          <button key={tab.value} onClick={() => { setStatusFilter(tab.value); setOffset(0); setAnsweringId(null); setAnswerText(''); setAnswerQuestion(''); setErrorMsg(null); }}
            className={`px-3 py-2.5 text-sm border-b-2 transition-colors -mb-px ${
              statusFilter === tab.value
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : !data?.data?.length ? (
        <div className="flex flex-col items-center py-20 text-zinc-400">
          <CheckCircle2 size={32} className="mb-3 text-emerald-300" />
          <p className="text-sm">
            {statusFilter === 'open' ? '미해결 주제가 없습니다' : '항목이 없습니다'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.data.map((item: any) => (
            <Card key={item.id} className="p-4">
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp size={14} className="text-amber-500" />
                    <span className="text-sm font-bold text-zinc-800">{item.occurrence_count}회 발생</span>
                    <Badge variant="outline">{SOURCE_LABEL[item.source] || item.source}</Badge>
                    {item.category && <Badge variant="secondary">{item.category}</Badge>}
                  </div>
                  <p className="text-sm text-zinc-700 mt-1">{item.topic}</p>
                  {item.sample_question && item.sample_question !== item.topic && (
                    <p className="text-xs text-zinc-400 mt-1">예시: {item.sample_question}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-zinc-400">
                    <span>유사도 {Math.round((item.avg_similarity ?? 0) * 100)}%</span>
                    <span>첫 발생 {new Date(item.first_seen_at).toLocaleDateString('ko-KR')}</span>
                    <span>최근 {new Date(item.last_seen_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                </div>
                {item.status === 'open' && (
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => {
                      setAnsweringId(answeringId === item.id ? null : item.id);
                      setAnswerQuestion(item.sample_question || item.topic);
                      setAnswerText('');
                    }}>답변 등록</Button>
                    <Button size="sm" variant="secondary"
                      onClick={() => dismissMutation.mutate({ id: Number(item.id) })}
                      disabled={dismissMutation.isPending}>무시</Button>
                  </div>
                )}
              </div>

              {answeringId === item.id && (
                <div className="mt-4 pt-4 border-t border-zinc-100 space-y-3">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">질문 (수정 가능)</label>
                    <Textarea value={answerQuestion} onChange={(e: any) => setAnswerQuestion(e.currentTarget.value)}
                      rows={2} />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">답변</label>
                    <Textarea value={answerText} onChange={(e: any) => setAnswerText(e.currentTarget.value)}
                      placeholder="이 주제에 대한 답변을 입력하세요..." rows={3} autoFocus />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="success"
                      onClick={() => resolveMutation.mutate({
                        id: Number(item.id),
                        question: answerQuestion,
                        answer: answerText,
                        category: item.category || undefined,
                      })}
                      disabled={resolveMutation.isPending || !answerText.trim() || !answerQuestion.trim()}>
                      {resolveMutation.isPending ? '처리중...' : '지식 등록 + 해결'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setAnsweringId(null)}>
                      <X size={14} /> 취소
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {data && data.total > limit && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-zinc-400">총 {data.total}건</p>
          <div className="flex gap-2">
            <Button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} variant="outline" size="sm">이전</Button>
            <Button onClick={() => setOffset(offset + limit)} disabled={data.data.length < limit} variant="outline" size="sm">다음</Button>
          </div>
        </div>
      )}
    </div>
  );
}
