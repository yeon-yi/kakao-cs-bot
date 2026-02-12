'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: '대기중', color: 'bg-yellow-100 text-yellow-800' },
  sent: { label: '전송완료', color: 'bg-green-100 text-green-800' },
  failed: { label: '실패', color: 'bg-red-100 text-red-800' },
  cancelled: { label: '취소', color: 'bg-gray-100 text-gray-600' },
};

export default function ProactivePage() {
  const [inactiveDays, setInactiveDays] = useState(5);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [blockRoomId, setBlockRoomId] = useState('');
  const [blockReason, setBlockReason] = useState('해지요청');
  const [activeTab, setActiveTab] = useState<'greetings' | 'blocks'>('greetings');

  const utils = trpc.useUtils();

  // 비활성 방 조회
  const { data: inactiveRooms, isLoading: inactiveLoading } = trpc.proactive.inactiveRooms.useQuery({
    inactiveDays,
  });

  // 대기중 인사 메시지 목록
  const { data: messagesData, isLoading: messagesLoading } = trpc.proactive.messages.useQuery({
    status: statusFilter,
    limit: 50,
  });

  // 차단된 방 목록
  const { data: blockedData, isLoading: blockedLoading } = trpc.proactive.blocks.list.useQuery({
    includeHistory: false,
  });

  // 대기 건수
  const { data: pendingData } = trpc.proactive.pendingCount.useQuery();

  // 인사 생성 mutation
  const generateMutation = trpc.proactive.generateGreetings.useMutation({
    onSuccess: (result) => {
      utils.proactive.messages.invalidate();
      utils.proactive.pendingCount.invalidate();
      utils.proactive.inactiveRooms.invalidate();
      alert(`${result.created}건의 인사 메시지가 생성되었습니다.`);
    },
  });

  // 차단/해제 mutation
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
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">자동 인사 / 차단 관리</h1>
      <p className="text-muted-foreground text-sm mb-6">
        비활성 채팅방에 자동 인사를 보내고, 해지요청한 고객의 방을 차단 관리합니다.
      </p>

      {/* Tab buttons */}
      <div className="flex gap-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('greetings')}
          className={`px-4 py-2 text-sm border-b-2 transition-colors ${
            activeTab === 'greetings'
              ? 'border-primary text-foreground font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          자동 인사
          {pendingData && pendingData.count > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500 text-white rounded-full">
              {pendingData.count}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('blocks')}
          className={`px-4 py-2 text-sm border-b-2 transition-colors ${
            activeTab === 'blocks'
              ? 'border-primary text-foreground font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          차단 목록
          {blockedData && blockedData.total > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-red-500 text-white rounded-full">
              {blockedData.total}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'greetings' ? (
        <>
          {/* 비활성 방 감지 + 인사 생성 */}
          <div className="border rounded-lg p-4 bg-card mb-6">
            <h2 className="font-semibold mb-3">비활성 채팅방 감지</h2>
            <div className="flex items-center gap-3 mb-3">
              <label className="text-sm text-muted-foreground">비활성 기준:</label>
              <select
                value={inactiveDays}
                onChange={(e) => setInactiveDays(Number(e.currentTarget.value))}
                className="p-1.5 border rounded text-sm"
              >
                <option value={3}>3일</option>
                <option value={5}>5일</option>
                <option value={7}>7일</option>
                <option value={14}>14일</option>
              </select>
              <span className="text-sm text-muted-foreground">이상 대화 없는 방</span>
            </div>

            {inactiveLoading ? (
              <p className="text-sm text-muted-foreground">조회 중...</p>
            ) : inactiveRooms && inactiveRooms.length > 0 ? (
              <>
                <p className="text-sm mb-3">
                  <span className="font-medium text-orange-600">{inactiveRooms.length}개</span> 방이 {inactiveDays}일 이상 비활성 상태입니다.
                </p>
                <div className="max-h-40 overflow-y-auto border rounded p-2 mb-3 text-sm space-y-1">
                  {inactiveRooms.map((room: any) => (
                    <div key={room.roomId} className="flex justify-between text-xs">
                      <span className="truncate flex-1">{room.roomId}</span>
                      <span className="text-muted-foreground ml-2">{room.inactiveDays}일 전</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => generateMutation.mutate({ inactiveDays })}
                  disabled={generateMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {generateMutation.isPending ? '생성 중...' : `${inactiveRooms.length}건 인사 메시지 생성`}
                </button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">비활성 채팅방이 없습니다.</p>
            )}
          </div>

          {/* 인사 메시지 목록 */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">인사 메시지 이력</h2>
              <select
                value={statusFilter || ''}
                onChange={(e) => setStatusFilter(e.currentTarget.value || undefined)}
                className="p-1.5 border rounded text-sm"
              >
                <option value="">전체</option>
                <option value="pending">대기중</option>
                <option value="sent">전송완료</option>
                <option value="failed">실패</option>
                <option value="cancelled">취소</option>
              </select>
            </div>

            {messagesLoading ? (
              <p className="text-sm text-muted-foreground">로딩 중...</p>
            ) : !messagesData?.data || messagesData.data.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">인사 메시지가 없습니다.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {messagesData.data.map((msg: any) => {
                  const status = STATUS_LABELS[msg.status] || STATUS_LABELS.pending;
                  return (
                    <div key={msg.id} className="border rounded p-3 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium truncate">{msg.room_id}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs mb-1">{msg.message}</p>
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>{new Date(msg.created_at).toLocaleString('ko-KR')}</span>
                        {msg.inactive_days && <span>비활성 {msg.inactive_days}일</span>}
                        {msg.sent_at && <span>전송: {new Date(msg.sent_at).toLocaleString('ko-KR')}</span>}
                        {msg.last_error && <span className="text-red-500">오류: {msg.last_error}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* 차단 추가 */}
          <div className="border rounded-lg p-4 bg-card mb-6">
            <h2 className="font-semibold mb-3">방 차단 추가</h2>
            <p className="text-sm text-muted-foreground mb-3">
              해지요청한 고객의 채팅방을 차단하면 봇 응답과 자동 인사가 모두 중지됩니다.
            </p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">방 ID (채팅방 이름)</label>
                <input
                  type="text"
                  value={blockRoomId}
                  onChange={(e) => setBlockRoomId(e.currentTarget.value)}
                  placeholder="채팅방 이름 입력"
                  className="w-full p-2 border rounded text-sm mt-1"
                />
              </div>
              <div className="w-40">
                <label className="text-xs text-muted-foreground">사유</label>
                <select
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.currentTarget.value)}
                  className="w-full p-2 border rounded text-sm mt-1"
                >
                  <option value="해지요청">해지요청</option>
                  <option value="고객요청">고객요청 (응답 중지)</option>
                  <option value="테스트방">테스트방</option>
                  <option value="기타">기타</option>
                </select>
              </div>
              <button
                onClick={() => {
                  if (!blockRoomId.trim()) return;
                  blockMutation.mutate({ roomId: blockRoomId.trim(), reason: blockReason });
                }}
                disabled={blockMutation.isPending || !blockRoomId.trim()}
                className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
              >
                차단
              </button>
            </div>
            {blockMutation.error && (
              <p className="text-sm text-destructive mt-2">{blockMutation.error.message}</p>
            )}
          </div>

          {/* 차단 목록 */}
          <div className="border rounded-lg p-4 bg-card">
            <h2 className="font-semibold mb-3">차단된 채팅방</h2>
            {blockedLoading ? (
              <p className="text-sm text-muted-foreground">로딩 중...</p>
            ) : !blockedData?.data || blockedData.data.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>차단된 채팅방이 없습니다.</p>
              </div>
            ) : (
              <div className="border rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2.5 text-left font-medium">방 ID</th>
                      <th className="px-4 py-2.5 text-left font-medium">사유</th>
                      <th className="px-4 py-2.5 text-left font-medium">차단일시</th>
                      <th className="px-4 py-2.5 text-left font-medium">차단자</th>
                      <th className="px-4 py-2.5 text-right font-medium w-24">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blockedData.data.map((block: any) => (
                      <tr key={block.id} className="border-b hover:bg-muted/25">
                        <td className="px-4 py-2.5 font-medium">{block.room_id}</td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-xs">
                            {block.reason}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {new Date(block.blocked_at).toLocaleString('ko-KR')}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {block.blocked_by || '-'}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => unblockMutation.mutate({ roomId: block.room_id })}
                            disabled={unblockMutation.isPending}
                            className="px-3 py-1 text-xs text-green-700 hover:bg-green-50 border border-green-300 rounded"
                          >
                            해제
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
