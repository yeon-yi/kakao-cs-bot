'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

interface FailedQuery {
  id: number;
  question: string;
  userMessage: string;
  roomId: string;
  createdAt: string;
  confidence: number | null;
}

export default function KnowledgeFeedbackPage() {
  const [feedbackAnswer, setFeedbackAnswer] = useState('');
  const [feedbackCategory, setFeedbackCategory] = useState('일반');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState('');

  const addKnowledge = trpc.knowledge.add.useMutation();

  // 낮은 confidence 대화 조회 (실제로는 conversations에서 confidence < 0.6인 것을 조회)
  // 임시로 빈 리스트 표시 (봇 가동 후 데이터 쌓임)
  const [items] = useState<FailedQuery[]>([]);

  async function handleTeach() {
    if (!selectedQuestion.trim() || !feedbackAnswer.trim()) return;

    try {
      await addKnowledge.mutateAsync({
        question: selectedQuestion,
        answer: feedbackAnswer,
        category: feedbackCategory,
        tier: 1,
        tags: ['피드백'],
      });
      alert('학습 완료!');
      setSelectedId(null);
      setSelectedQuestion('');
      setFeedbackAnswer('');
    } catch (err: any) {
      alert('오류: ' + err.message);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">미답변 피드백</h1>
      <p className="text-gray-500 mb-6">봇이 답변하지 못했거나 confidence가 낮았던 질문을 확인하고 학습시킬 수 있습니다.</p>

      {items.length === 0 ? (
        <div className="text-center py-20 text-gray-400 border rounded-lg">
          <p className="text-lg mb-2">아직 미답변 데이터가 없습니다.</p>
          <p className="text-sm">봇이 가동되면 답변하지 못한 질문이 여기에 표시됩니다.</p>
          <p className="text-sm mt-4">또는 "대화 학습" 메뉴에서 직접 질문을 테스트해 보세요.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="border rounded-lg p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{item.userMessage}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    방: {item.roomId} | {new Date(item.createdAt).toLocaleString('ko-KR')}
                    {item.confidence !== null && ` | 신뢰도: ${Math.round(item.confidence * 100)}%`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedId(item.id);
                    setSelectedQuestion(item.userMessage);
                  }}
                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                >
                  학습시키기
                </button>
              </div>

              {selectedId === item.id && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <textarea
                    value={feedbackAnswer}
                    onChange={(e) => setFeedbackAnswer(e.currentTarget.value)}
                    placeholder="이 질문에 대한 올바른 답변을 입력하세요..."
                    rows={3}
                    className="w-full p-2 border rounded text-sm"
                  />
                  <div className="flex gap-2">
                    <select
                      value={feedbackCategory}
                      onChange={(e) => setFeedbackCategory(e.currentTarget.value)}
                      className="p-2 border rounded text-sm"
                    >
                      <option value="네이버트래픽">네이버트래픽</option>
                      <option value="블로그기자단">블로그기자단</option>
                      <option value="인스타그램">인스타그램</option>
                      <option value="홈페이지">홈페이지</option>
                      <option value="SEO">SEO</option>
                      <option value="영상촬영">영상촬영</option>
                      <option value="일반">일반</option>
                    </select>
                    <button onClick={handleTeach} className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700">
                      등록
                    </button>
                    <button onClick={() => setSelectedId(null)} className="px-4 py-2 bg-gray-300 text-gray-700 text-sm rounded">
                      취소
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
