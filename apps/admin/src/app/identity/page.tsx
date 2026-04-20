'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserCheck, Users, Briefcase, AlertTriangle, Search, Shield } from 'lucide-react';

const ROLE_TABS = [
  { value: 'all', label: '전체' },
  { value: 'collision', label: '이름 충돌' },
  { value: 'unknown', label: '미확인' },
  { value: 'advertiser', label: '광고주' },
  { value: 'company_staff', label: '직원' },
];

const ROLE_DISPLAY: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
  advertiser: { label: '광고주', variant: 'default' },
  company_staff: { label: '직원', variant: 'secondary' },
  unknown: { label: '미확인', variant: 'warning' },
  bot: { label: '봇', variant: 'outline' },
  partner: { label: '파트너', variant: 'outline' },
};

export default function IdentityPage() {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 30;

  const utils = trpc.useUtils();

  const { data: collisions, isLoading: collisionLoading } = trpc.identity.nameCollisions.useQuery();
  const { data: members, isLoading: membersLoading } = trpc.identity.listMembers.useQuery(
    { role: tab !== 'all' && tab !== 'collision' ? tab : undefined, search: search || undefined, offset, limit },
    { enabled: tab !== 'collision' },
  );

  const confirmMutation = trpc.identity.confirm.useMutation({
    onSuccess: () => {
      utils.identity.listMembers.invalidate();
      utils.identity.nameCollisions.invalidate();
      utils.identity.listUnknown.invalidate();
    },
  });

  const isLoading = tab === 'collision' ? collisionLoading : membersLoading;
  const showCollision = tab === 'collision';

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[hsl(var(--foreground))]">신원 확인</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
          채팅방 참여자의 역할을 관리합니다. 직원과 이름이 같은 광고주가 있으면 '이름 충돌'에서 확인하세요.
        </p>
      </div>

      {/* 이름 충돌 경고 배너 */}
      {collisions && collisions.length > 0 && tab !== 'collision' && (
        <button
          onClick={() => { setTab('collision'); setOffset(0); }}
          className="w-full mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-left hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
            <span className="text-sm text-amber-800 font-medium">
              이름 충돌 {collisions.length}건 감지
            </span>
            <span className="text-xs text-amber-600 ml-auto">클릭하여 확인 &rarr;</span>
          </div>
          <p className="text-xs text-amber-600 mt-1">
            광고주와 직원의 이름이 같아 AI 응답이 차단될 수 있습니다. 광고주로 확인하면 정상 응답됩니다.
          </p>
        </button>
      )}

      {/* 탭 + 검색 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1 border-b border-zinc-200 flex-1">
          {ROLE_TABS.map((t) => (
            <button key={t.value} onClick={() => { setTab(t.value); setOffset(0); }}
              className={`px-3 py-2.5 text-sm border-b-2 transition-colors -mb-px ${
                tab === t.value
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}>
              {t.label}
              {t.value === 'collision' && collisions && collisions.length > 0 && (
                <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                  {collisions.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {!showCollision && (
        <div className="mb-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <Input type="text" value={search} onChange={(e) => { setSearch(e.currentTarget.value); setOffset(0); }}
              placeholder="이름 또는 방 ID로 검색..." className="pl-9" />
          </div>
        </div>
      )}

      {confirmMutation.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {confirmMutation.error.message}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : showCollision ? (
        /* 이름 충돌 목록 */
        !collisions?.length ? (
          <div className="flex flex-col items-center py-20 text-zinc-400">
            <Shield size={32} className="mb-3 text-emerald-300" />
            <p className="text-sm">이름 충돌이 없습니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {collisions.map((item: any) => (
              <Card key={item.id} className="p-4 border-amber-200 bg-amber-50/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle size={14} className="text-amber-500" />
                      <span className="font-medium text-zinc-900">{item.user_name}</span>
                      <Badge variant="warning">이름 충돌</Badge>
                      {item.confidence >= 0.9 && item.confirmed_by && (
                        <Badge variant="success">확인됨</Badge>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 space-y-0.5 mt-1">
                      <p>방: <span className="text-zinc-700">{item.room_id}</span></p>
                      <p>현재 역할: <span className="text-zinc-700">{ROLE_DISPLAY[item.role]?.label || item.role}</span>
                        {' '}(확신도 {Math.round(item.confidence * 100)}%)</p>
                      <p>매칭 직원: <span className="text-zinc-700">{item.staff_real_name}</span>
                        {item.department && <span className="text-zinc-400"> ({item.department})</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {item.confidence < 0.9 || !item.confirmed_by ? (
                      <>
                        <Button size="sm" variant="success"
                          onClick={() => confirmMutation.mutate({ userId: item.user_id, roomId: item.room_id, role: 'ADVERTISER' })}
                          disabled={confirmMutation.isPending}>
                          <Briefcase size={14} /> 광고주 확인
                        </Button>
                        <Button size="sm" variant="secondary"
                          onClick={() => confirmMutation.mutate({ userId: item.user_id, roomId: item.room_id, role: 'COMPANY_STAFF' })}
                          disabled={confirmMutation.isPending}>
                          <Users size={14} /> 직원
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-emerald-600 py-2">광고주 확인 완료</span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        /* 일반 멤버 목록 */
        !members?.data?.length ? (
          <div className="flex flex-col items-center py-20 text-zinc-400">
            <UserCheck size={32} className="mb-3 text-zinc-300" />
            <p className="text-sm">
              {tab === 'unknown' ? '미확인 사용자가 없습니다' : '해당 조건의 사용자가 없습니다'}
            </p>
          </div>
        ) : (
          <>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-zinc-50">
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">이름</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">방 ID</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">역할</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">확신도</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-600 w-44">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {members.data.map((m: any) => {
                    const roleInfo = ROLE_DISPLAY[m.role] || { label: m.role, variant: 'outline' as const };
                    return (
                      <tr key={m.id} className="border-b last:border-0 hover:bg-zinc-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-zinc-900">{m.user_name || '-'}</span>
                            {m.has_staff_match && m.role === 'advertiser' && (
                              <span title="직원 이름과 동일"><AlertTriangle size={12} className="text-amber-500" /></span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-500 text-xs max-w-[200px] truncate">{m.room_id}</td>
                        <td className="px-4 py-3">
                          <Badge variant={roleInfo.variant}>{roleInfo.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-zinc-500">
                          {Math.round(m.confidence * 100)}%
                          {m.confirmed_by && <span className="text-emerald-500 ml-1" title={`확인: ${m.confirmed_by}`}>&#10003;</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-1 justify-end">
                            {m.role !== 'company_staff' && (
                              <Button size="sm" variant="ghost"
                                onClick={() => confirmMutation.mutate({ userId: m.user_id, roomId: m.room_id, role: 'COMPANY_STAFF' })}
                                disabled={confirmMutation.isPending}
                                className="text-zinc-500 hover:text-zinc-700">
                                <Users size={12} /> 직원
                              </Button>
                            )}
                            {m.role !== 'advertiser' && (
                              <Button size="sm" variant="ghost"
                                onClick={() => confirmMutation.mutate({ userId: m.user_id, roomId: m.room_id, role: 'ADVERTISER' })}
                                disabled={confirmMutation.isPending}
                                className="text-zinc-500 hover:text-zinc-700">
                                <Briefcase size={12} /> 광고주
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            {members.total > limit && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-zinc-400">총 {members.total}명</p>
                <div className="flex gap-2">
                  <Button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} variant="outline" size="sm">이전</Button>
                  <Button onClick={() => setOffset(offset + limit)} disabled={members.data.length < limit} variant="outline" size="sm">다음</Button>
                </div>
              </div>
            )}
          </>
        )
      )}

      <p className="mt-3 text-xs text-zinc-400">
        {showCollision
          ? `이름 충돌 ${collisions?.length ?? 0}건`
          : `총 ${members?.total ?? 0}명`}
      </p>
    </div>
  );
}
