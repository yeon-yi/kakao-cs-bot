'use client';

import { useState, useRef } from 'react';
import { trpc } from '@/lib/trpc';

export default function KnowledgeUploadPage() {
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processText = trpc.upload.processText.useMutation();

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSource(file.name);
    setError('');

    if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      const text = await file.text();
      setContent(text);
    } else if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
      const text = await file.text();
      setContent(text);
    } else if (file.type.includes('json') || file.name.endsWith('.json')) {
      const text = await file.text();
      try {
        const json = JSON.parse(text);
        setContent(JSON.stringify(json, null, 2));
      } catch {
        setContent(text);
      }
    } else {
      setError('지원 형식: .txt, .md, .csv, .json (PDF/엑셀은 텍스트로 복사 후 직접 붙여넣기 해주세요)');
      return;
    }
  }

  async function handleSubmit() {
    if (!content.trim() || !source.trim()) {
      setError('내용과 출처를 모두 입력해 주세요.');
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
    } catch (err: any) {
      setError(err.message || 'AI 처리 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">파일 업로드 학습</h1>
      <p className="text-gray-500 mb-6">문서를 업로드하면 AI가 자동으로 Q&A를 추출하여 지식으로 등록합니다.</p>

      <div className="space-y-4">
        {/* 파일 선택 */}
        <div>
          <label className="block text-sm font-medium mb-1">파일 선택</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.csv,.json"
            onChange={handleFileSelect}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {/* 출처 */}
        <div>
          <label className="block text-sm font-medium mb-1">출처/문서명 *</label>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.currentTarget.value)}
            placeholder="예: 서비스 소개서 2024, 가격표, FAQ 문서"
            className="w-full p-2 border rounded"
          />
        </div>

        {/* 카테고리 */}
        <div>
          <label className="block text-sm font-medium mb-1">카테고리 (선택)</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.currentTarget.value)}
            className="w-full p-2 border rounded"
          >
            <option value="">AI가 자동 분류</option>
            <option value="네이버트래픽">네이버트래픽</option>
            <option value="블로그기자단">블로그기자단</option>
            <option value="인스타그램">인스타그램</option>
            <option value="홈페이지">홈페이지</option>
            <option value="SEO">SEO</option>
            <option value="영상촬영">영상촬영</option>
            <option value="일반">일반</option>
          </select>
        </div>

        {/* 텍스트 내용 */}
        <div>
          <label className="block text-sm font-medium mb-1">
            내용 * <span className="text-gray-400">(파일 선택 시 자동 입력, 또는 직접 붙여넣기)</span>
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.currentTarget.value)}
            rows={12}
            placeholder="여기에 문서 내용을 붙여넣거나 위에서 파일을 선택하세요..."
            className="w-full p-3 border rounded font-mono text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">{content.length.toLocaleString()}/50,000자</p>
        </div>

        {/* 에러 */}
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded">{error}</div>
        )}

        {/* 제출 */}
        <button
          onClick={handleSubmit}
          disabled={isProcessing || !content.trim() || !source.trim()}
          className="w-full py-3 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'AI 분석 중... (최대 30초 소요)' : 'AI로 지식 추출 및 등록'}
        </button>

        {/* 결과 */}
        {result && (
          <div className="p-4 bg-green-50 rounded space-y-3">
            <h3 className="font-bold text-green-800">
              처리 완료! ({result.added}건 등록, {result.skipped}건 건너뜀)
            </h3>
            <p className="text-sm text-gray-600">
              AI 모델: {result.aiModel} | 비용: ${result.aiCost?.toFixed(4)} | 처리시간: {(result.processingTime / 1000).toFixed(1)}초
            </p>
            <div className="space-y-1">
              {result.results?.map((r: any, i: number) => (
                <div key={i} className={`text-sm ${r.status === 'added' ? 'text-green-700' : 'text-gray-500'}`}>
                  {r.status === 'added' ? '✓' : '○'} {r.question}
                  {r.reason && <span className="text-xs text-gray-400 ml-2">({r.reason})</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
