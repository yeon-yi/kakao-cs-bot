'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

interface Message {
  role: 'user' | 'bot';
  text: string;
}

export default function KnowledgeChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [learnMode, setLearnMode] = useState(false);
  const [learnQuestion, setLearnQuestion] = useState('');
  const [learnAnswer, setLearnAnswer] = useState('');
  const [learnCategory, setLearnCategory] = useState('일반');

  const searchKnowledge = trpc.knowledge.search.useQuery(
    { question: input, limit: 3 },
    { enabled: false }
  );

  const addKnowledge = trpc.knowledge.add.useMutation();

  async function handleSend() {
    if (!input.trim()) return;
    const question = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setIsLoading(true);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/trpc/knowledge.search?input=${encodeURIComponent(JSON.stringify({ json: { question, limit: 3 } }))}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
        }
      );
      const data = await res.json();
      const results = data.result?.data?.json?.results || [];

      if (results.length > 0 && results[0].similarity > 0.7) {
        const best = results[0];
        setMessages(prev => [...prev, {
          role: 'bot',
          text: `[유사도: ${Math.round(best.similarity * 100)}%]\n\n${best.answer}\n\n📂 카테고리: ${best.category || '없음'}`,
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'bot',
          text: '이 질문에 대한 답변을 찾지 못했습니다.\n\n아래 "학습시키기" 버튼을 눌러 직접 답변을 등록할 수 있습니다.',
        }]);
        setLearnQuestion(question);
        setLearnMode(true);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: '검색 중 오류가 발생했습니다.' }]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLearn() {
    if (!learnQuestion.trim() || !learnAnswer.trim()) return;

    try {
      await addKnowledge.mutateAsync({
        question: learnQuestion,
        answer: learnAnswer,
        category: learnCategory,
        tier: 1,
        tags: [],
      });
      setMessages(prev => [...prev, { role: 'bot', text: `✓ 학습 완료! "${learnQuestion}"에 대한 답변이 등록되었습니다.` }]);
      setLearnMode(false);
      setLearnQuestion('');
      setLearnAnswer('');
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'bot', text: `학습 실패: ${err.message}` }]);
    }
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-120px)]">
      <h1 className="text-2xl font-bold mb-2">대화형 학습</h1>
      <p className="text-gray-500 mb-4">봇에게 질문하고, 답변이 없으면 직접 가르칠 수 있습니다.</p>

      {/* 대화 영역 */}
      <div className="flex-1 overflow-y-auto border rounded-t-lg p-4 space-y-3 bg-gray-50">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 mt-10">질문을 입력하면 봇이 지식 DB에서 답변을 검색합니다.</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-lg whitespace-pre-wrap text-sm ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-white border text-gray-800'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border p-3 rounded-lg text-gray-400 text-sm">검색 중...</div>
          </div>
        )}
      </div>

      {/* 학습 모드 */}
      {learnMode && (
        <div className="border-x p-4 bg-yellow-50 space-y-2">
          <p className="text-sm font-medium text-yellow-800">답변을 등록하여 봇을 학습시키세요:</p>
          <input
            type="text"
            value={learnQuestion}
            onChange={(e) => setLearnQuestion(e.currentTarget.value)}
            placeholder="질문"
            className="w-full p-2 border rounded text-sm"
          />
          <textarea
            value={learnAnswer}
            onChange={(e) => setLearnAnswer(e.currentTarget.value)}
            placeholder="답변을 입력하세요..."
            rows={3}
            className="w-full p-2 border rounded text-sm"
          />
          <div className="flex gap-2">
            <select
              value={learnCategory}
              onChange={(e) => setLearnCategory(e.currentTarget.value)}
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
            <button onClick={handleLearn} className="px-4 py-2 bg-yellow-600 text-white rounded text-sm hover:bg-yellow-700">
              학습시키기
            </button>
            <button onClick={() => setLearnMode(false)} className="px-4 py-2 bg-gray-300 text-gray-700 rounded text-sm">
              취소
            </button>
          </div>
        </div>
      )}

      {/* 입력 */}
      <div className="flex border rounded-b-lg overflow-hidden">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="질문을 입력하세요..."
          className="flex-1 p-3 outline-none"
          disabled={isLoading}
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className="px-6 bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          전송
        </button>
      </div>
    </div>
  );
}
