'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Smartphone, Wifi, WifiOff, AlertTriangle, Trash2, RefreshCw,
  Activity, MessageSquare, Clock,
} from 'lucide-react';

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  online: { label: '연결됨', color: 'text-emerald-600', bg: 'bg-emerald-50', icon: Wifi },
  offline: { label: '오프라인', color: 'text-zinc-400', bg: 'bg-zinc-50', icon: WifiOff },
  error: { label: '오류', color: 'text-red-600', bg: 'bg-red-50', icon: AlertTriangle },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

export default function DevicesPage() {
  const utils = trpc.useUtils();
  const { data: devices, isLoading } = trpc.devices.list.useQuery(undefined, {
    refetchInterval: 10_000, // 10초마다 갱신
  });
  const { data: summary } = trpc.devices.summary.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  const removeMutation = trpc.devices.remove.useMutation({
    onSuccess: () => {
      utils.devices.list.invalidate();
      utils.devices.summary.invalidate();
    },
  });
  const resetMutation = trpc.devices.resetError.useMutation({
    onSuccess: () => {
      utils.devices.list.invalidate();
      utils.devices.summary.invalidate();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">연결 기기</h1>
        <p className="mt-1 text-sm text-zinc-500">
          봇 앱이 실행중인 모바일 기기를 실시간으로 모니터링합니다 (10초마다 갱신)
        </p>
      </div>

      {/* 요약 카드 */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
          <Card className="p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Smartphone size={14} className="text-zinc-500" />
              <p className="text-xs text-zinc-500">전체 기기</p>
            </div>
            <p className="text-2xl font-bold text-zinc-800">{summary.total}</p>
          </Card>
          <Card className={cn('p-3 text-center', summary.online > 0 && 'ring-1 ring-emerald-200')}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Wifi size={14} className="text-emerald-500" />
              <p className="text-xs text-zinc-500">연결됨</p>
            </div>
            <p className="text-2xl font-bold text-emerald-600">{summary.online}</p>
          </Card>
          <Card className={cn('p-3 text-center', summary.error > 0 && 'ring-1 ring-red-200')}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <AlertTriangle size={14} className="text-red-500" />
              <p className="text-xs text-zinc-500">오류</p>
            </div>
            <p className="text-2xl font-bold text-red-600">{summary.error}</p>
          </Card>
          <Card className="p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <MessageSquare size={14} className="text-blue-500" />
              <p className="text-xs text-zinc-500">오늘 메시지</p>
            </div>
            <p className="text-2xl font-bold text-blue-600">{summary.totalMessagesToday}</p>
          </Card>
        </div>
      )}

      {/* 기기 목록 */}
      {!devices || devices.length === 0 ? (
        <Card className="p-8 text-center">
          <Smartphone size={32} className="mx-auto mb-3 text-zinc-300" />
          <p className="text-sm text-zinc-400">등록된 기기가 없습니다</p>
          <p className="text-xs text-zinc-300 mt-1">
            봇 앱이 서버에 연결되면 자동으로 표시됩니다
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {devices.map((device: any) => {
            const cfg = statusConfig[device.status] || statusConfig.offline;
            const StatusIcon = cfg.icon;

            return (
              <Card key={device.deviceId} className={cn(
                'p-4',
                device.status === 'error' && 'ring-1 ring-red-200 border-red-100',
                device.status === 'online' && 'ring-1 ring-emerald-100',
              )}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* 상태 아이콘 */}
                    <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', cfg.bg)}>
                      <StatusIcon size={18} className={cfg.color} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-zinc-800 truncate">
                          {device.deviceName || device.deviceId}
                        </span>
                        <Badge variant={device.status === 'online' ? 'default' : device.status === 'error' ? 'destructive' : 'secondary'}>
                          {cfg.label}
                        </Badge>
                        {device.status === 'online' && (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          {timeAgo(device.lastHeartbeat)}
                        </span>
                        {device.appVersion && <span>v{device.appVersion}</span>}
                        {device.osVersion && <span>{device.osVersion}</span>}
                        <span className="flex items-center gap-1">
                          <Activity size={11} />
                          오늘 {device.messagesToday}건 / 총 {device.messagesSent}건
                        </span>
                      </div>

                      {device.lastError && (
                        <div className="mt-2 rounded bg-red-50 px-2.5 py-1.5 text-xs text-red-600">
                          <span className="font-medium">오류:</span> {device.lastError}
                          {device.errorCount > 1 && <span className="ml-1 text-red-400">({device.errorCount}회)</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 액션 버튼 */}
                  <div className="flex gap-1.5 shrink-0">
                    {device.status === 'error' && (
                      <Button size="sm" variant="outline"
                        onClick={() => resetMutation.mutate({ deviceId: device.deviceId })}
                        disabled={resetMutation.isPending}
                        title="오류 초기화">
                        <RefreshCw size={14} />
                      </Button>
                    )}
                    <Button size="sm" variant="secondary"
                      onClick={() => {
                        if (confirm(`${device.deviceName || device.deviceId} 기기를 삭제하시겠습니까?`)) {
                          removeMutation.mutate({ deviceId: device.deviceId });
                        }
                      }}
                      disabled={removeMutation.isPending}
                      title="기기 삭제">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
