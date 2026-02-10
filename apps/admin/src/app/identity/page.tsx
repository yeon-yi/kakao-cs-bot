'use client';

import { trpc } from '@/lib/trpc';

export default function IdentityPage() {
  const { data: unknownUsers, isLoading } = trpc.identity.listUnknown.useQuery();
  const utils = trpc.useUtils();

  const confirmMutation = trpc.identity.confirm.useMutation({
    onSuccess: () => utils.identity.listUnknown.invalidate(),
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">신원 확인 대기</h1>

      {isLoading ? (
        <p className="text-muted-foreground">로딩 중...</p>
      ) : (
        <div className="space-y-4">
          {unknownUsers?.map((user) => (
            <div key={user.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{user.user_name || '이름 없음'}</h3>
                  <p className="text-sm text-muted-foreground">
                    방: {user.room_id} | ID: {user.user_id}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    확신도: {(user.confidence * 100).toFixed(0)}%
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => confirmMutation.mutate({
                    userId: user.user_id, roomId: user.room_id, role: 'COMPANY_STAFF',
                  })} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">
                    직원
                  </button>
                  <button onClick={() => confirmMutation.mutate({
                    userId: user.user_id, roomId: user.room_id, role: 'ADVERTISER',
                  })} className="rounded-md bg-secondary px-3 py-1.5 text-xs hover:bg-secondary/80">
                    광고주
                  </button>
                </div>
              </div>
            </div>
          ))}
          {(!unknownUsers || unknownUsers.length === 0) && (
            <p className="py-8 text-center text-muted-foreground">미확인 사용자가 없습니다</p>
          )}
        </div>
      )}
    </div>
  );
}
