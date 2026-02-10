'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export default function PromptsPage() {
  const { data: prompts, isLoading } = trpc.prompts.list.useQuery();
  const [selected, setSelected] = useState<string | null>(null);
  const [editedTemplate, setEditedTemplate] = useState('');
  const [reason, setReason] = useState('');

  const { data: prompt } = trpc.prompts.get.useQuery(
    { name: selected! },
    { enabled: !!selected },
  );

  const utils = trpc.useUtils();
  const updateMutation = trpc.prompts.update.useMutation({
    onSuccess: () => {
      utils.prompts.list.invalidate();
      utils.prompts.get.invalidate();
      setReason('');
    },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">프롬프트 관리</h1>

      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-1 space-y-1">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">프롬프트 목록</h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">로딩 중...</p>
          ) : (
            prompts?.map((p) => (
              <button key={p.name} onClick={() => { setSelected(p.name); setEditedTemplate(p.template); }}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  selected === p.name ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                }`}>
                {p.name}
                <span className="ml-2 text-xs opacity-60">v{p.version}</span>
              </button>
            ))
          )}
        </div>

        <div className="col-span-3">
          {prompt ? (
            <div>
              <div className="mb-4">
                <h2 className="text-lg font-semibold">{prompt.name}</h2>
                <p className="text-sm text-muted-foreground">버전 {prompt.version}</p>
              </div>

              <textarea value={editedTemplate}
                onChange={(e) => setEditedTemplate(e.currentTarget.value)}
                className="h-96 w-full rounded-md border bg-muted/50 p-4 font-mono text-sm"
              />

              <div className="mt-4 flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-sm">변경 사유</label>
                  <input type="text" value={reason} onChange={(e) => setReason(e.currentTarget.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm" placeholder="변경 이유를 입력하세요" />
                </div>
                <button onClick={() => updateMutation.mutate({
                  name: prompt.name, template: editedTemplate, reason,
                })} disabled={!reason || updateMutation.isPending}
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {updateMutation.isPending ? '저장 중...' : '저장'}
                </button>
              </div>

              {updateMutation.isSuccess && (
                <p className="mt-2 text-sm text-green-600">저장되었습니다.</p>
              )}
            </div>
          ) : (
            <p className="py-20 text-center text-muted-foreground">왼쪽에서 프롬프트를 선택하세요</p>
          )}
        </div>
      </div>
    </div>
  );
}
