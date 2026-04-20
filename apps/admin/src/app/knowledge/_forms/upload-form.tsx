'use client';

import { useState, useRef } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select, FormField } from '@/components/ui/input';
import { Upload, FileText, CheckCircle, XCircle } from 'lucide-react';

const CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];
const ACCEPT_TYPES = '.txt,.md,.csv,.json';
const MAX_CHARS = 50000;

export interface KnowledgeUploadFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function KnowledgeUploadForm({ onSuccess, onCancel }: KnowledgeUploadFormProps) {
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const processText = trpc.upload.processText.useMutation();

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSource(file.name);
    setError('');

    try {
      const text = await file.text();
      if (text.length > MAX_CHARS) {
        setError(
          `파일이 너무 큽니다 (${text.length.toLocaleString()}자). ${MAX_CHARS.toLocaleString()}자 이하로 줄여주세요.`,
        );
        return;
      }
      if (file.name.endsWith('.json')) {
        try {
          setContent(JSON.stringify(JSON.parse(text), null, 2));
        } catch {
          setContent(text);
        }
      } else {
        setContent(text);
      }
    } catch {
      setError('파일을 읽는 중 오류가 발생했습니다.');
    }
  }

  async function handleSubmit() {
    if (!content.trim()) {
      setError('내용을 입력해 주세요.');
      return;
    }
    if (!source.trim()) {
      setError('출처를 입력해 주세요.');
      return;
    }
    if (content.length > MAX_CHARS) {
      setError(`내용이 ${MAX_CHARS.toLocaleString()}자를 초과합니다.`);
      return;
    }

    setIsProcessing(true);
    setError('');
    setResult(null);

    try {
      const res = await processText.mutateAsync({
        content: content.trim(),
        source: source.trim(),
        category: category || undefined,
      });
      setResult(res);
      utils.knowledge.list.invalidate();
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'AI 처리 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  }

  function handleReset() {
    setContent('');
    setSource('');
    setCategory('');
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="space-y-5">
      <FormField label="파일 선택" hint="지원 형식: .txt, .md, .csv, .json (최대 50,000자)">
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-zinc-200 px-4 py-3 text-sm text-zinc-500 transition-colors hover:border-blue-300 hover:text-blue-600">
            <Upload size={18} />
            <span>파일 찾기</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_TYPES}
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
          {source && (
            <div className="flex items-center gap-2 text-sm text-zinc-600">
              <FileText size={16} className="text-zinc-400" />
              {source}
            </div>
          )}
        </div>
      </FormField>

      <FormField
        label="출처/문서명"
        required
        hint="어떤 문서에서 추출한 지식인지 식별하기 위한 이름"
      >
        <Input
          type="text"
          value={source}
          onChange={(e) => setSource(e.currentTarget.value)}
          placeholder="예: 서비스 소개서 2024, 가격표, FAQ 문서"
        />
      </FormField>

      <FormField label="카테고리" hint="지정하지 않으면 AI가 자동으로 분류합니다">
        <Select value={category} onChange={(e) => setCategory(e.currentTarget.value)}>
          <option value="">AI 자동 분류</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="내용"
        required
        hint="파일 선택 시 자동 입력되거나, 직접 붙여넣기 할 수 있습니다"
      >
        <Textarea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          rows={10}
          placeholder="여기에 문서 내용을 붙여넣거나 위에서 파일을 선택하세요..."
          className="font-mono text-xs leading-relaxed"
        />
        <div className="mt-1 flex justify-between">
          <span />
          <span
            className={`text-xs ${
              content.length > MAX_CHARS ? 'text-red-500 font-medium' : 'text-zinc-400'
            }`}
          >
            {content.length.toLocaleString()}/{MAX_CHARS.toLocaleString()}자
          </span>
        </div>
      </FormField>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="flex gap-2 border-t border-zinc-100 pt-5">
        <Button
          onClick={handleSubmit}
          disabled={isProcessing || !content.trim() || !source.trim()}
          size="sm"
          className="flex-1"
        >
          {isProcessing ? 'AI 분석 중... (최대 30초 소요)' : 'AI로 지식 추출 및 등록'}
        </Button>
        {(content || source || result) && (
          <Button onClick={handleReset} variant="secondary" size="sm">
            초기화
          </Button>
        )}
        <Button type="button" onClick={() => onCancel?.()} variant="secondary" size="sm">
          닫기
        </Button>
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle size={18} className="text-emerald-600" />
            <p className="font-medium text-emerald-800">
              처리 완료 - {result.added}건 등록, {result.skipped}건 건너뜀
            </p>
          </div>
          <div className="flex gap-3 text-xs text-zinc-500">
            <span>AI: {result.aiModel}</span>
            <span>비용: ${result.aiCost?.toFixed(4)}</span>
            <span>소요: {(result.processingTime / 1000).toFixed(1)}초</span>
          </div>
          <div className="space-y-1 pt-1">
            {result.results?.map((r: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                {r.status === 'added' ? (
                  <CheckCircle size={14} className="mt-0.5 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle size={14} className="mt-0.5 text-zinc-400 shrink-0" />
                )}
                <span className={r.status === 'added' ? 'text-zinc-700' : 'text-zinc-400'}>
                  {r.question}
                  {r.reason && <span className="ml-2 text-xs text-zinc-400">({r.reason})</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
