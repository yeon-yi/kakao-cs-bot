'use client';

import { useState, useRef, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Send, BookOpen, X } from 'lucide-react';
import { getBaseUrl } from '@/lib/trpc';

const CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

interface Message {
  role: 'user' | 'bot';
  text: string;
  similarity?: number;
  category?: string;
}

export default function KnowledgeChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [learnMode, setLearnMode] = useState(false);
  const [learnQuestion, setLearnQuestion] = useState('');
  const [learnAnswer, setLearnAnswer] = useState('');
  const [learnCategory, setLearnCategory] = useState('일반');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const addKnowledge = trpc.knowledge.add.useMutation();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || isLoading) return;
    const question = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setIsLoading(true);
    setLearnMode(false);

    try {
      const res = await fetch(
        `${getBaseUrl()}/trpc/knowledge.search?input=${encodeURIComponent(JSON.stringify({ json: { question, limit: 3 } }))}`,
        { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } },
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const results = data.result?.data?.json?.results || [];

      if (results.length > 0 && results[0].similarity > 0.7) {
        const best = results[0];
        setMessages(prev => [...prev, {
          role: 'bot',
          text: best.answer,
          similarity: best.similarity,
          category: best.category,
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'bot',
          text: '이 질문에 대한 답변을 찾지 못했습니다. 아래에서 직접 답변을 등록하여 봇을 학습시킬 수 있습니다.',
          similarity: results[0]?.similarity,
        }]);
        setLearnQuestion(question);
        setLearnMode(true);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'bot', text: `검색 중 오류: ${err.message || '알 수 없는 오류'}` }]);
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
      setMessages(prev => [...prev, {
        role: 'bot',
        text: `학습 완료 - "${learnQuestion}"에 대한 답변이 등록되었습니다.`,
      }]);
      setLearnMode(false);
      setLearnQuestion('');
      setLearnAnswer('');
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'bot', text: `학습 실패: ${err.message}` }]);
    }
  }

  return (
    <div className="mx-auto max-w-3xl flex flex-col h-[calc(100vh-100px)]">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-zinc-900">대화형 학습</h1>
        <p className="text-sm text-zinc-500 mt-1">
          봇에게 질문하여 지식 DB를 검색하고, 답변이 없으면 직접 가르칠 수 있습니다.
        </p>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden p-0">
        {/* 채팅 영역 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin bg-zinc-50/50">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
              <BookOpen size={32} className="mb-3 text-zinc-300" />
              <p className="text-sm">질문을 입력하면 지식 DB에서 답변을 검색합니다</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-white border border-zinc-200 text-zinc-700 rounded-bl-md shadow-sm'
              }`}>
                <p className="whitespace-pre-wrap">{msg.text}</p>
                {msg.role === 'bot' && msg.similarity !== undefined && (
                  <div className="mt-2 flex gap-2">
                    {msg.category && <Badge variant="outline">{msg.category}</Badge>}
                    <span className="text-[11px] text-zinc-400">유사도 {Math.round(msg.similarity * 100)}%</span>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border bg-white px-4 py-3 shadow-sm">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-300" style={{ animationDelay: '0ms' }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-300" style={{ animationDelay: '150ms' }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-300" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 학습 모드 */}
        {learnMode && (
          <div className="border-t bg-amber-50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-amber-800">답변을 등록하여 봇을 학습시키세요</p>
              <button onClick={() => setLearnMode(false)} className="text-amber-600 hover:text-amber-800">
                <X size={16} />
              </button>
            </div>
            <Input value={learnQuestion} onChange={(e) => setLearnQuestion(e.currentTarget.value)} placeholder="질문" />
            <Textarea value={learnAnswer} onChange={(e) => setLearnAnswer(e.currentTarget.value)}
              placeholder="답변을 입력하세요..." rows={3} />
            <div className="flex gap-2">
              <Select value={learnCategory} onChange={(e) => setLearnCategory(e.currentTarget.value)} className="w-40">
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </Select>
              <Button onClick={handleLearn} disabled={addKnowledge.isPending || !learnAnswer.trim()} size="sm" variant="success">
                {addKnowledge.isPending ? '등록 중...' : '학습시키기'}
              </Button>
            </div>
          </div>
        )}

        {/* 입력 */}
        <div className="flex items-center gap-2 border-t bg-white p-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="질문을 입력하세요..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={isLoading || !input.trim()} size="md">
            <Send size={16} />
          </Button>
        </div>
      </Card>
    </div>
  );
}
