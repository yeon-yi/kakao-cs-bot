'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea, Select } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AlertCircle, MessageSquare, X, CheckCircle2, XCircle, Brain } from 'lucide-react';

const STATUS_TABS = [
  { value: undefined, label: '전체' },
  { value: 'pending' as const, label: '대기중' },
  { value: 'assigned' as const, label: '배정됨' },
  { value: 'answered' as const, label: '답변됨' },
  { value: 'learned' as const, label: '학습완료' },
  { value: 'dismissed' as const, label: '무시' },
];

const CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  pending: { variant: 'warning', label: '대기중' },
  assigned: { variant: 'primary', label: '배정됨' },
  answered: { variant: 'success', label: '답변됨' },
  learned: { variant: 'purple', label: '학습완료' },
  dismissed: { variant: 'default', label: '무시' },
};

export default function EscalationPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [answerCategory, setAnswerCategory] = useState('');
  const [verificationResult, setVerificationResult] = useState<{ knowledgeId: string; interpretation: string } | null>(null);
  const limit = 20;

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.escalation.list.useQuery({ status: statusFilter as any, offset, limit });
  const { data: pendingData } = trpc.escalation.pendingCount.useQuery();

  const answerMutation = trpc.escalation.answer.useMutation({
    onSuccess: (result) => {
      utils.escalation.list.invalidate();
      utils.escalation.pendingCount.invalidate();
      setSelectedId(null);
      setAnswerText('');
      setAnswerCategory('');
      // AI 검증 결과 표시
      if (result.aiInterpretation && result.knowledgeId) {
        setVerificationResult({ knowledgeId: result.knowledgeId, interpretation: result.aiInterpretation });
      }
    },
  });

  const verifyMutation = trpc.escalation.verify.useMutation({
    onSuccess: () => {
      setVerificationResult(null);
      utils.escalation.list.invalidate();
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
    answerMutation.mutate({ id, answer: answerText, category: answerCategory || undefined });
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-900">에스컬레이션</h1>
          {pendingData && pendingData.count > 0 && (
            <Badge variant="destructive" className="px-3 py-1 text-sm">{pendingData.count}건 대기중</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          봇이 답변하지 못한 질문을 확인합니다. 답변 등록 시 자동 학습 + 질문 변형 생성 + AI 이해도 검증이 진행됩니다.
        </p>
      </div>

      {/* AI 검증 모달 */}
      {verificationResult && (
        <Card className="mb-5 p-4 border-blue-200 bg-blue-50/50">
          <div className="flex items-start gap-3">
            <Brain size={20} className="text-blue-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-800 mb-2">AI 이해도 검증</p>
              <p className="text-sm text-blue-700 whitespace-pre-wrap">{verificationResult.interpretation}</p>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="success"
                  onClick={() => verifyMutation.mutate({ knowledgeId: verificationResult.knowledgeId, status: 'verified' })}
                  disabled={verifyMutation.isPending}>
                  <CheckCircle2 size={14} /> 정확함
                </Button>
                <Button size="sm" variant="destructive"
                  onClick={() => verifyMutation.mutate({ knowledgeId: verificationResult.knowledgeId, status: 'needs_correction' })}
                  disabled={verifyMutation.isPending}>
                  <XCircle size={14} /> 수정 필요
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setVerificationResult(null)}>
                  나중에
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 상태 탭 */}
      <div className="flex gap-1 mb-5 border-b border-zinc-200">
        {STATUS_TABS.map((tab) => (
          <button key={tab.label} onClick={() => { setStatusFilter(tab.value); setOffset(0); }}
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
          <AlertCircle size={32} className="mb-3 text-zinc-300" />
          <p className="text-sm">에스컬레이션이 없습니다</p>
          <p className="mt-1 text-xs">봇이 답변하지 못한 질문이 발생하면 여기에 표시됩니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.data.map((item: any) => {
            const badge = STATUS_BADGE[item.status] || STATUS_BADGE.pending;
            return (
              <Card key={item.id} className="p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-zinc-900">{item.user_message}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {item.category && <Badge variant="outline">{item.category}</Badge>}
                      <span className="text-xs text-zinc-400">
                        {item.user_name || item.user_id} / {item.room_id}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {new Date(item.created_at).toLocaleString('ko-KR')}
                      </span>
                      {item.confidence !== null && (
                        <span className="text-xs text-zinc-400">유사도 {Math.round((item.confidence ?? 0) * 100)}%</span>
                      )}
                    </div>
                    {item.bot_response && (
                      <p className="mt-2 pl-3 border-l-2 border-zinc-200 text-sm text-zinc-500">{item.bot_response}</p>
                    )}
                    {item.answer && (
                      <p className="mt-2 pl-3 border-l-2 border-emerald-300 text-sm text-emerald-700">{item.answer}</p>
                    )}
                  </div>
                  {(item.status === 'pending' || item.status === 'assigned') && (
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" onClick={() => {
                        setSelectedId(selectedId === item.id ? null : item.id);
                        setAnswerText('');
                        setAnswerCategory(item.category || '일반');
                      }}>
                        <MessageSquare size={14} /> 답변
                      </Button>
                      <Button size="sm" variant="secondary"
                        onClick={() => dismissMutation.mutate({ id: item.id })}
                        disabled={dismissMutation.isPending}>
                        무시
                      </Button>
                    </div>
                  )}
                </div>

                {selectedId === item.id && (
                  <div className="mt-4 pt-4 border-t border-zinc-100 space-y-3">
                    <Textarea value={answerText} onChange={(e: any) => setAnswerText(e.currentTarget.value)}
                      placeholder="이 질문에 대한 올바른 답변을 입력하세요..." rows={3} autoFocus />
                    <div className="flex gap-2 items-center">
                      <Select value={answerCategory} onChange={(e: any) => setAnswerCategory(e.currentTarget.value)} className="w-40">
                        {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </Select>
                      <Button onClick={() => handleAnswer(item.id)}
                        disabled={answerMutation.isPending || !answerText.trim()} size="sm" variant="success">
                        {answerMutation.isPending ? '처리중...' : '답변 등록 + 학습'}
                      </Button>
                      <Button onClick={() => setSelectedId(null)} size="sm" variant="secondary">
                        <X size={14} /> 취소
                      </Button>
                    </div>
                    {answerMutation.error && <p className="text-sm text-red-600">{answerMutation.error.message}</p>}
                  </div>
                )}
              </Card>
            );
          })}
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
