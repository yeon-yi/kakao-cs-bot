'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Save } from 'lucide-react';

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
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[hsl(var(--foreground))]">프롬프트 관리</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
          봇의 응답 생성에 사용되는 시스템 프롬프트를 관리합니다. 변경 시 사유를 기록하여 버전 이력을 관리합니다.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-5">
        <div className="col-span-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">프롬프트 목록</p>
          <div className="space-y-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              </div>
            ) : (
              prompts?.map((p) => (
                <button
                  key={p.name}
                  onClick={() => { setSelected(p.name); setEditedTemplate(p.template); setReason(''); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    selected === p.name
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  <FileText size={14} className={selected === p.name ? 'text-blue-200' : 'text-zinc-400'} />
                  <span className="flex-1 truncate">{p.name}</span>
                  <Badge variant={selected === p.name ? 'default' : 'outline'} className={selected === p.name ? 'bg-blue-500 text-white border-0' : ''}>
                    v{p.version}
                  </Badge>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="col-span-3">
          {prompt ? (
            <Card>
              <div className="mb-4">
                <h2 className="text-base font-semibold text-zinc-900">{prompt.name}</h2>
                <p className="text-xs text-zinc-400 mt-0.5">버전 {prompt.version}</p>
              </div>

              <Textarea
                value={editedTemplate}
                onChange={(e) => setEditedTemplate(e.currentTarget.value)}
                className="h-96 font-mono text-xs leading-relaxed bg-zinc-50"
              />

              <div className="mt-4 flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700">변경 사유</label>
                  <Input
                    type="text" value={reason} onChange={(e) => setReason(e.currentTarget.value)}
                    placeholder="변경 이유를 입력하세요 (필수)"
                  />
                </div>
                <Button
                  onClick={() => updateMutation.mutate({ name: prompt.name, template: editedTemplate, reason })}
                  disabled={!reason.trim() || updateMutation.isPending}
                >
                  <Save size={16} />
                  {updateMutation.isPending ? '저장 중...' : '저장'}
                </Button>
              </div>

              {updateMutation.isSuccess && (
                <p className="mt-2 text-sm text-emerald-600">저장되었습니다.</p>
              )}
              {updateMutation.error && (
                <p className="mt-2 text-sm text-red-600">{updateMutation.error.message}</p>
              )}
            </Card>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
              <FileText size={32} className="mb-3 text-zinc-300" />
              <p className="text-sm">왼쪽에서 프롬프트를 선택하세요</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
