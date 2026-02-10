'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

export default function KnowledgeListPage() {
  const [tier, setTier] = useState<number | undefined>();
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data, isLoading } = trpc.knowledge.list.useQuery({
    tier, category: category || undefined, offset, limit,
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">지식 관리</h1>
        <Link href="/knowledge/add"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          + 지식 추가
        </Link>
      </div>

      <div className="mb-4 flex gap-4">
        <select value={tier ?? ''} onChange={(e) => setTier(e.currentTarget.value ? Number(e.currentTarget.value) : undefined)}
          className="rounded-md border px-3 py-2 text-sm">
          <option value="">전체 Tier</option>
          <option value="1">Tier 1 (공식)</option>
          <option value="2">Tier 2 (학습)</option>
          <option value="3">Tier 3 (대화)</option>
        </select>
        <input type="text" placeholder="카테고리 필터" value={category}
          onChange={(e) => setCategory(e.currentTarget.value)}
          className="rounded-md border px-3 py-2 text-sm" />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">로딩 중...</p>
      ) : (
        <>
          <div className="space-y-3">
            {data?.data.map((item) => (
              <div key={item.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        item.tier === 1 ? 'bg-blue-100 text-blue-700' :
                        item.tier === 2 ? 'bg-green-100 text-green-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        Tier {item.tier}
                      </span>
                      {item.category && (
                        <span className="text-xs text-muted-foreground">{item.category}</span>
                      )}
                    </div>
                    <p className="mt-2 font-medium">{item.question}</p>
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{item.answer}</p>
                  </div>
                  <div className="ml-4 text-right text-xs text-muted-foreground">
                    <p>사용: {item.usage_count}회</p>
                    <p>확신도: {(item.confidence_score * 100).toFixed(0)}%</p>
                  </div>
                </div>
                {item.tags && item.tags.length > 0 && (
                  <div className="mt-2 flex gap-1">
                    {item.tags.map((tag) => (
                      <span key={tag} className="rounded bg-muted px-2 py-0.5 text-xs">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {(!data?.data || data.data.length === 0) && (
              <p className="py-8 text-center text-muted-foreground">지식이 없습니다</p>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">총 {data?.total ?? 0}건</p>
            <div className="flex gap-2">
              <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50">이전</button>
              <button onClick={() => setOffset(offset + limit)} disabled={(data?.data.length ?? 0) < limit}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50">다음</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
