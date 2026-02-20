'use client';

import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserCheck, Users, Briefcase } from 'lucide-react';

export default function IdentityPage() {
  const { data: unknownUsers, isLoading } = trpc.identity.listUnknown.useQuery();
  const utils = trpc.useUtils();

  const confirmMutation = trpc.identity.confirm.useMutation({
    onSuccess: () => utils.identity.listUnknown.invalidate(),
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">신원 확인</h1>
            <p className="text-sm text-zinc-500 mt-1">
              봇이 자동 분류하지 못한 사용자의 역할을 수동으로 지정합니다. 직원으로 지정하면 봇이 자동 응답하지 않습니다.
            </p>
          </div>
          {unknownUsers && unknownUsers.length > 0 && (
            <Badge variant="warning" className="text-sm px-3 py-1">{unknownUsers.length}명 대기</Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : !unknownUsers?.length ? (
        <div className="flex flex-col items-center py-20 text-zinc-400">
          <UserCheck size={32} className="mb-3 text-zinc-300" />
          <p className="text-sm">미확인 사용자가 없습니다</p>
          <p className="mt-1 text-xs">새로운 사용자가 감지되면 여기에 표시됩니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {unknownUsers.map((user) => (
            <Card key={user.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-900">{user.user_name || '이름 없음'}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span>방: {user.room_id}</span>
                    <span className="text-zinc-200">|</span>
                    <span>ID: {user.user_id}</span>
                    <span className="text-zinc-200">|</span>
                    <span>확신도: {(user.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm"
                    onClick={() => confirmMutation.mutate({ userId: user.user_id, roomId: user.room_id, role: 'COMPANY_STAFF' })}
                    disabled={confirmMutation.isPending}>
                    <Users size={14} /> 직원
                  </Button>
                  <Button size="sm" variant="secondary"
                    onClick={() => confirmMutation.mutate({ userId: user.user_id, roomId: user.room_id, role: 'ADVERTISER' })}
                    disabled={confirmMutation.isPending}>
                    <Briefcase size={14} /> 광고주
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {confirmMutation.error && (
        <p className="mt-3 text-sm text-red-600">{confirmMutation.error.message}</p>
      )}
    </div>
  );
}
