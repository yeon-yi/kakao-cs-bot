'use client';

import { trpc } from '@/lib/trpc';

export default function GeneralConfigPage() {
  const { data: configs, isLoading } = trpc.config.list.useQuery();
  const utils = trpc.useUtils();

  const updateMutation = trpc.config.update.useMutation({
    onSuccess: () => utils.config.list.invalidate(),
  });

  if (isLoading) return <p className="text-muted-foreground">로딩 중...</p>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">일반 설정</h1>

      <div className="space-y-4">
        {configs?.map((config) => (
          <div key={config.key} className="flex items-center justify-between rounded-lg border bg-card p-4">
            <div>
              <p className="font-medium">{config.key}</p>
              {config.description && (
                <p className="text-sm text-muted-foreground">{config.description}</p>
              )}
              {config.category && (
                <span className="mt-1 inline-block rounded bg-muted px-2 py-0.5 text-xs">{config.category}</span>
              )}
            </div>
            <div className="text-right">
              <code className="rounded bg-muted px-2 py-1 text-sm">
                {JSON.stringify(config.value)}
              </code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
