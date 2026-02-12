import { getSupabaseAdmin } from '../client';
import type { Database } from '../types';

type RoomBlockInsert = Database['public']['Tables']['room_blocks']['Insert'];
type ProactiveInsert = Database['public']['Tables']['proactive_messages']['Insert'];

export class ProactiveRepository {
  private get db() { return getSupabaseAdmin(); }

  // ===================== Room Blocks =====================

  async blockRoom(input: RoomBlockInsert) {
    // 기존 활성 차단 해제 후 새로 추가
    await this.db.from('room_blocks')
      .update({ is_active: false, unblocked_at: new Date().toISOString() })
      .eq('room_id', input.room_id)
      .eq('is_active', true);

    const { data, error } = await this.db.from('room_blocks')
      .insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async unblockRoom(roomId: string) {
    const { error } = await this.db.from('room_blocks')
      .update({ is_active: false, unblocked_at: new Date().toISOString() })
      .eq('room_id', roomId)
      .eq('is_active', true);
    if (error) throw error;
  }

  async isBlocked(roomId: string): Promise<boolean> {
    const { data } = await this.db.from('room_blocks')
      .select('id')
      .eq('room_id', roomId)
      .eq('is_active', true)
      .limit(1)
      .single();
    return !!data;
  }

  async listBlocked(options?: { offset?: number; limit?: number }) {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    const { data, error, count } = await this.db.from('room_blocks')
      .select('*', { count: 'exact' })
      .eq('is_active', true)
      .order('blocked_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async listAllBlocks(options?: { offset?: number; limit?: number }) {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    const { data, error, count } = await this.db.from('room_blocks')
      .select('*', { count: 'exact' })
      .order('blocked_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ===================== Proactive Messages =====================

  async createMessage(input: ProactiveInsert) {
    const { data, error } = await this.db.from('proactive_messages')
      .insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async getPendingMessages(limit = 10) {
    const { data, error } = await this.db.from('proactive_messages')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async markSent(id: number) {
    const { error } = await this.db.from('proactive_messages')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async markFailed(id: number, errorMsg: string) {
    // 시도 횟수 증가, 3회 이상이면 cancelled
    const { data } = await this.db.from('proactive_messages')
      .select('attempts').eq('id', id).single();
    const attempts = (data?.attempts ?? 0) + 1;
    const status = attempts >= 3 ? 'cancelled' : 'pending';

    const { error } = await this.db.from('proactive_messages')
      .update({ status, attempts, last_error: errorMsg })
      .eq('id', id);
    if (error) throw error;
  }

  async cancelByRoom(roomId: string) {
    const { error } = await this.db.from('proactive_messages')
      .update({ status: 'cancelled' })
      .eq('room_id', roomId)
      .eq('status', 'pending');
    if (error) throw error;
  }

  async listMessages(options?: { status?: string; offset?: number; limit?: number }) {
    let query = this.db.from('proactive_messages')
      .select('*', { count: 'exact' });
    if (options?.status) query = query.eq('status', options.status);
    query = query.order('created_at', { ascending: false });
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 20;
    query = query.range(offset, offset + limit - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async pendingCount() {
    const { count, error } = await this.db.from('proactive_messages')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) throw error;
    return count ?? 0;
  }

  // ===================== 비활성 방 감지 =====================

  /**
   * conversations 테이블에서 최근 N일 이상 대화가 없는 방 목록 조회.
   * 차단된 방과 이미 대기중인 인사가 있는 방은 제외.
   */
  async findInactiveRooms(inactiveDays: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

    // 1. 모든 방의 마지막 대화 시간 조회 (최소 1건 이상 대화가 있는 방만)
    const { data: rooms, error } = await this.db
      .from('conversations')
      .select('room_id, user_name, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;

    // 방별 마지막 활동 추출
    const roomLastActivity = new Map<string, { lastAt: string; userName: string | null }>();
    for (const row of rooms ?? []) {
      if (!roomLastActivity.has(row.room_id)) {
        roomLastActivity.set(row.room_id, {
          lastAt: row.created_at,
          userName: row.user_name,
        });
      }
    }

    // 2. 차단된 방 목록
    const { data: blockedRooms } = await this.db.from('room_blocks')
      .select('room_id')
      .eq('is_active', true);
    const blockedSet = new Set((blockedRooms ?? []).map(r => r.room_id));

    // 3. 이미 대기중인 인사 메시지가 있는 방
    const { data: pendingRooms } = await this.db.from('proactive_messages')
      .select('room_id')
      .eq('status', 'pending');
    const pendingSet = new Set((pendingRooms ?? []).map(r => r.room_id));

    // 4. 필터링
    const inactiveRooms: Array<{
      roomId: string;
      userName: string | null;
      lastActivity: string;
      inactiveDays: number;
    }> = [];

    for (const [roomId, info] of roomLastActivity.entries()) {
      if (blockedSet.has(roomId)) continue;
      if (pendingSet.has(roomId)) continue;

      const lastDate = new Date(info.lastAt);
      if (lastDate < cutoffDate) {
        const daysDiff = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        inactiveRooms.push({
          roomId,
          userName: info.userName,
          lastActivity: info.lastAt,
          inactiveDays: daysDiff,
        });
      }
    }

    return inactiveRooms;
  }
}
