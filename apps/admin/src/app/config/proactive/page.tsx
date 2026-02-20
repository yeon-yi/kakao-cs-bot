'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bell, ShieldOff, Send, Clock, Ban, CheckCircle } from 'lucide-react';

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  pending: { variant: 'warning', label: '대기중' },
  sent: { variant: 'success', label: '전송완료' },
  failed: { variant: 'destructive', label: '실패' },
  cancelled: { variant: 'default', label: '취소' },
};

export default function ProactivePage() {
  const [inactiveDays, setInactiveDays] = useState(5);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [blockRoomId, setBlockRoomId] = useState('');
  const [blockReason, setBlockReason] = useState('해지요청');
  const [activeTab, setActiveTab] = useState<'greetings' | 'blocks'>('greetings');

  const utils = trpc.useUtils();

  const { data: inactiveRooms, isLoading: inactiveLoading } = trpc.proactive.inactiveRooms.useQuery({ inactiveDays });
  const { data: messagesData, isLoading: messagesLoading } = trpc.proactive.messages.useQuery({ status: statusFilter, limit: 50 });
  const { data: blockedData, isLoading: blockedLoading } = trpc.proactive.blocks.list.useQuery({ includeHistory: false });
  const { data: pendingData } = trpc.proactive.pendingCount.useQuery();

  const generateMutation = trpc.proactive.generateGreetings.useMutation({
    onSuccess: (result) => {
      utils.proactive.messages.invalidate();
      utils.proactive.pendingCount.invalidate();
      utils.proactive.inactiveRooms.invalidate();
      alert(`${result.created}건의 인사 메시지가 생성되었습니다.`);
    },
  });

  const blockMutation = trpc.proactive.blocks.block.useMutation({
    onSuccess: () => {
      utils.proactive.blocks.list.invalidate();
      utils.proactive.inactiveRooms.invalidate();
      setBlockRoomId('');
      setBlockReason('해지요청');
    },
  });

  const unblockMutation = trpc.proactive.blocks.unblock.useMutation({
    onSuccess: () => {
      utils.proactive.blocks.list.invalidate();
      utils.proactive.inactiveRooms.invalidate();
    },
  });

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">자동 인사 / 차단 관리</h1>
        <p className="text-sm text-zinc-500 mt-1">
          비활성 채팅방에 자동 인사를 보내고, 해지요청한 고객의 방을 차단합니다.
        </p>
      </div>

      {/* Tab */}
      <div className="flex gap-1 mb-5 border-b border-zinc-200">
        <button onClick={() => setActiveTab('greetings')}
          className={`px-3 py-2.5 text-sm border-b-2 transition-colors -mb-px ${
            activeTab === 'greetings'
              ? 'border-blue-600 text-blue-600 font-medium'
              : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}>
          <span className="flex items-center gap-1.5">
            <Bell size={14} /> 자동 인사
            {pendingData && pendingData.count > 0 && (
              <Badge variant="warning" className="text-[10px] px-1.5 py-0">{pendingData.count}</Badge>
            )}
          </span>
        </button>
        <button onClick={() => setActiveTab('blocks')}
          className={`px-3 py-2.5 text-sm border-b-2 transition-colors -mb-px ${
            activeTab === 'blocks'
              ? 'border-blue-600 text-blue-600 font-medium'
              : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}>
          <span className="flex items-center gap-1.5">
            <ShieldOff size={14} /> 차단 목록
            {blockedData && blockedData.total > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{blockedData.total}</Badge>
            )}
          </span>
        </button>
      </div>

      {activeTab === 'greetings' ? (
        <>
          {/* 비활성 방 감지 */}
          <Card className="mb-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-900">비활성 채팅방 감지</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">비활성 기준:</span>
                <Select value={String(inactiveDays)} onChange={(e) => setInactiveDays(Number(e.currentTarget.value))}
                  className="w-20 text-xs">
                  <option value="3">3일</option>
                  <option value="5">5일</option>
                  <option value="7">7일</option>
                  <option value="14">14일</option>
                </Select>
              </div>
            </div>

            {inactiveLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              </div>
            ) : inactiveRooms && inactiveRooms.length > 0 ? (
              <>
                <p className="text-sm text-zinc-600 mb-3">
                  <span className="font-semibold text-orange-600">{inactiveRooms.length}개</span> 방이 {inactiveDays}일 이상 비활성 상태입니다.
                </p>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50 p-2 mb-4 space-y-1 scrollbar-thin">
                  {inactiveRooms.map((room: any) => (
                    <div key={room.roomId} className="flex justify-between text-xs px-2 py-1">
                      <span className="text-zinc-700 truncate flex-1">{room.roomId}</span>
                      <span className="text-zinc-400 ml-2 shrink-0">{room.inactiveDays}일 전</span>
                    </div>
                  ))}
                </div>
                <Button onClick={() => generateMutation.mutate({ inactiveDays })}
                  disabled={generateMutation.isPending}>
                  <Send size={14} />
                  {generateMutation.isPending ? '생성 중...' : `${inactiveRooms.length}건 인사 메시지 생성`}
                </Button>
              </>
            ) : (
              <p className="text-sm text-zinc-400 py-4 text-center">비활성 채팅방이 없습니다.</p>
            )}
          </Card>

          {/* 인사 메시지 이력 */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-900">인사 메시지 이력</h2>
              <Select value={statusFilter || ''} onChange={(e) => setStatusFilter(e.currentTarget.value || undefined)}
                className="w-28 text-xs">
                <option value="">전체</option>
                <option value="pending">대기중</option>
                <option value="sent">전송완료</option>
                <option value="failed">실패</option>
                <option value="cancelled">취소</option>
              </Select>
            </div>

            {messagesLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              </div>
            ) : !messagesData?.data || messagesData.data.length === 0 ? (
              <p className="text-sm text-zinc-400 py-8 text-center">인사 메시지가 없습니다.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
                {messagesData.data.map((msg: any) => {
                  const badge = STATUS_BADGE[msg.status] || STATUS_BADGE.pending;
                  return (
                    <div key={msg.id} className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-zinc-800 truncate">{msg.room_id}</span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <p className="text-xs text-zinc-500 mb-2 line-clamp-2">{msg.message}</p>
                      <div className="flex flex-wrap gap-3 text-[11px] text-zinc-400">
                        <span className="flex items-center gap-1"><Clock size={10} /> {new Date(msg.created_at).toLocaleString('ko-KR')}</span>
                        {msg.inactive_days && <span>비활성 {msg.inactive_days}일</span>}
                        {msg.sent_at && <span>전송: {new Date(msg.sent_at).toLocaleString('ko-KR')}</span>}
                        {msg.last_error && <span className="text-red-500">오류: {msg.last_error}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      ) : (
        <>
          {/* 차단 추가 */}
          <Card className="mb-5">
            <h2 className="text-sm font-semibold text-zinc-900 mb-2">방 차단 추가</h2>
            <p className="text-xs text-zinc-500 mb-4">
              해지요청한 고객의 채팅방을 차단하면 봇 응답과 자동 인사가 모두 중지됩니다.
            </p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-medium text-zinc-600">방 ID (채팅방 이름)</label>
                <Input type="text" value={blockRoomId} onChange={(e) => setBlockRoomId(e.currentTarget.value)}
                  placeholder="채팅방 이름 입력" />
              </div>
              <div className="w-40">
                <label className="mb-1.5 block text-xs font-medium text-zinc-600">사유</label>
                <Select value={blockReason} onChange={(e) => setBlockReason(e.currentTarget.value)}>
                  <option value="해지요청">해지요청</option>
                  <option value="고객요청">고객요청 (응답 중지)</option>
                  <option value="테스트방">테스트방</option>
                  <option value="기타">기타</option>
                </Select>
              </div>
              <Button variant="destructive"
                onClick={() => { if (!blockRoomId.trim()) return; blockMutation.mutate({ roomId: blockRoomId.trim(), reason: blockReason }); }}
                disabled={blockMutation.isPending || !blockRoomId.trim()}>
                <Ban size={14} /> 차단
              </Button>
            </div>
            {blockMutation.error && (
              <p className="text-sm text-red-600 mt-2">{blockMutation.error.message}</p>
            )}
          </Card>

          {/* 차단 목록 */}
          <Card className="p-0 overflow-hidden">
            {blockedLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              </div>
            ) : !blockedData?.data || blockedData.data.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-zinc-400">
                <CheckCircle size={28} className="mb-2 text-zinc-300" />
                <p className="text-sm">차단된 채팅방이 없습니다.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-zinc-50">
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">방 ID</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">사유</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">차단일시</th>
                    <th className="px-4 py-3 text-left font-medium text-zinc-600">차단자</th>
                    <th className="px-4 py-3 text-right font-medium text-zinc-600 w-24">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {blockedData.data.map((block: any) => (
                    <tr key={block.id} className="border-b last:border-0 hover:bg-zinc-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-zinc-900">{block.room_id}</td>
                      <td className="px-4 py-3">
                        <Badge variant="destructive">{block.reason}</Badge>
                      </td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">
                        {new Date(block.blocked_at).toLocaleString('ko-KR')}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">{block.blocked_by || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="success"
                          onClick={() => unblockMutation.mutate({ roomId: block.room_id })}
                          disabled={unblockMutation.isPending}>
                          해제
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
