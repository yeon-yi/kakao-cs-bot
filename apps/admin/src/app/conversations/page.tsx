'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MessagesSquare, ChevronLeft, Clock, User } from 'lucide-react';

export default function ConversationsPage() {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const limit = 30;

  const { data: rooms, isLoading } = trpc.conversations.rooms.useQuery({
    search: search || undefined,
    offset,
    limit,
  });

  const { data: messages, isLoading: messagesLoading } = trpc.conversations.messages.useQuery(
    { roomId: selectedRoomId!, limit: 100 },
    { enabled: !!selectedRoomId },
  );

  if (selectedRoomId) {
    return (
      <div className="max-w-4xl mx-auto">
        <button onClick={() => setSelectedRoomId(null)}
          className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 mb-4 transition-colors">
          <ChevronLeft size={16} /> 채팅방 목록
        </button>

        <div className="mb-4">
          <h1 className="text-xl font-semibold text-zinc-900">{selectedRoomId}</h1>
          <p className="text-sm text-zinc-500 mt-0.5">최근 100건의 메시지를 표시합니다</p>
        </div>

        {messagesLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : !messages?.data?.length ? (
          <div className="flex flex-col items-center py-16 text-zinc-400">
            <MessagesSquare size={28} className="mb-2 text-zinc-300" />
            <p className="text-sm">메시지가 없습니다</p>
          </div>
        ) : (
          <Card className="p-4">
            <div className="space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto scrollbar-thin">
              {messages.data.map((msg: any, i: number) => {
                const isBot = msg.role === 'assistant' || msg.role === 'bot';
                return (
                  <div key={msg.id || i} className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[70%] rounded-xl px-4 py-2.5 text-sm ${
                      isBot
                        ? 'bg-zinc-100 text-zinc-800'
                        : 'bg-blue-600 text-white'
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{msg.content || msg.message}</p>
                      <p className={`text-[10px] mt-1 ${isBot ? 'text-zinc-400' : 'text-blue-200'}`}>
                        {new Date(msg.created_at).toLocaleString('ko-KR')}
                        {msg.user_name && !isBot && ` - ${msg.user_name}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">대화 이력</h1>
        <p className="text-sm text-zinc-500 mt-1">
          채팅방별 대화 내역을 조회합니다. 방 이름을 클릭하면 상세 메시지를 확인할 수 있습니다.
        </p>
      </div>

      <div className="mb-4">
        <Input type="text" value={search} onChange={(e) => { setSearch(e.currentTarget.value); setOffset(0); }}
          placeholder="방 이름 또는 사용자 이름으로 검색..." />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : !rooms?.data?.length ? (
        <div className="flex flex-col items-center py-16 text-zinc-400">
          <MessagesSquare size={32} className="mb-3 text-zinc-300" />
          <p className="text-sm">대화 이력이 없습니다</p>
          <p className="mt-1 text-xs">봇이 대화를 시작하면 여기에 표시됩니다</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {rooms.data.map((room: any) => (
              <Card key={room.room_id} className="p-4 cursor-pointer hover:border-zinc-300 transition-colors"
                onClick={() => setSelectedRoomId(room.room_id)}>
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-zinc-900 truncate">{room.room_id}</p>
                      {room.message_count && (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {room.message_count}건
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      {room.last_user_name && (
                        <span className="flex items-center gap-1"><User size={10} /> {room.last_user_name}</span>
                      )}
                      {room.last_message_at && (
                        <span className="flex items-center gap-1">
                          <Clock size={10} /> {new Date(room.last_message_at).toLocaleString('ko-KR')}
                        </span>
                      )}
                    </div>
                    {room.last_message && (
                      <p className="mt-1.5 text-xs text-zinc-500 truncate">{room.last_message}</p>
                    )}
                  </div>
                  <ChevronLeft size={16} className="text-zinc-300 rotate-180 shrink-0 ml-2" />
                </div>
              </Card>
            ))}
          </div>

          {rooms.total > limit && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-zinc-400">총 {rooms.total}개 채팅방</p>
              <div className="flex gap-2">
                <Button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
                  variant="outline" size="sm">이전</Button>
                <Button onClick={() => setOffset(offset + limit)} disabled={rooms.data.length < limit}
                  variant="outline" size="sm">다음</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
