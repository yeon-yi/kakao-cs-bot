import { query, queryOne, queryCount, getPool } from '../client';
import type { Database } from '../types';

type RoomBlockInsert = Database['public']['Tables']['room_blocks']['Insert'];
type ProactiveInsert = Database['public']['Tables']['proactive_messages']['Insert'];

export class ProactiveRepository {
  // ===================== Room Blocks =====================

  async blockRoom(input: RoomBlockInsert) {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 기존 활성 차단 해제
      await client.query(
        `UPDATE room_blocks SET is_active = false, unblocked_at = NOW() WHERE room_id = $1 AND is_active = true`,
        [input.room_id]
      );

      // 새 차단 추가
      const { rows } = await client.query(
        `INSERT INTO room_blocks (room_id, user_name, reason, blocked_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.room_id, input.user_name ?? null, input.reason ?? '해지요청', input.blocked_by ?? null]
      );

      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async unblockRoom(roomId: string) {
    await query(
      'UPDATE room_blocks SET is_active = false, unblocked_at = NOW() WHERE room_id = $1 AND is_active = true',
      [roomId]
    );
  }

  async isBlocked(roomId: string): Promise<boolean> {
    const row = await queryOne(
      'SELECT id FROM room_blocks WHERE room_id = $1 AND is_active = true LIMIT 1',
      [roomId]
    );
    return !!row;
  }

  async listBlocked(options?: { offset?: number; limit?: number }) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const data = await query(
      'SELECT * FROM room_blocks WHERE is_active = true ORDER BY blocked_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    const total = await queryCount(
      'SELECT COUNT(*) as count FROM room_blocks WHERE is_active = true'
    );
    return { data, total };
  }

  async listAllBlocks(options?: { offset?: number; limit?: number }) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const data = await query(
      'SELECT * FROM room_blocks ORDER BY blocked_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    const total = await queryCount('SELECT COUNT(*) as count FROM room_blocks');
    return { data, total };
  }

  // ===================== Proactive Messages =====================

  async createMessage(input: ProactiveInsert) {
    return queryOne(
      `INSERT INTO proactive_messages (room_id, user_name, message, message_type, status, scheduled_at, last_activity, inactive_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        input.room_id, input.user_name ?? null, input.message,
        input.message_type ?? 'greeting', input.status ?? 'pending',
        input.scheduled_at ?? new Date().toISOString(),
        input.last_activity ?? null, input.inactive_days ?? null,
      ]
    );
  }

  async getPendingMessages(limit = 10) {
    return query(
      `SELECT * FROM proactive_messages WHERE status = 'pending' AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC LIMIT $1`,
      [limit]
    );
  }

  async markSent(id: number) {
    await query(
      `UPDATE proactive_messages SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async markFailed(id: number, errorMsg: string) {
    const current = await queryOne<{ attempts: number }>(
      'SELECT attempts FROM proactive_messages WHERE id = $1',
      [id]
    );
    const attempts = (current?.attempts ?? 0) + 1;
    const status = attempts >= 3 ? 'cancelled' : 'pending';

    await query(
      'UPDATE proactive_messages SET status = $1, attempts = $2, last_error = $3 WHERE id = $4',
      [status, attempts, errorMsg, id]
    );
  }

  async cancelByRoom(roomId: string) {
    await query(
      `UPDATE proactive_messages SET status = 'cancelled' WHERE room_id = $1 AND status = 'pending'`,
      [roomId]
    );
  }

  async listMessages(options?: { status?: string; offset?: number; limit?: number }) {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (options?.status) {
      conditions.push(`status = $${idx}`);
      values.push(options.status);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    const countValues = [...values];
    values.push(limit, offset);

    const data = await query(
      `SELECT * FROM proactive_messages ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );
    const total = await queryCount(
      `SELECT COUNT(*) as count FROM proactive_messages ${where}`,
      countValues
    );
    return { data, total };
  }

  async pendingCount() {
    return queryCount(`SELECT COUNT(*) as count FROM proactive_messages WHERE status = 'pending'`);
  }

  // ===================== 비활성 방 감지 =====================

  async findInactiveRooms(inactiveDays: number) {
    // 단일 쿼리로 비활성 방을 감지 (차단된 방, 이미 대기중인 인사 방 제외)
    return query(
      `WITH last_activity AS (
         SELECT DISTINCT ON (room_id) room_id, user_name, created_at
         FROM conversations
         ORDER BY room_id, created_at DESC
       )
       SELECT la.room_id as "roomId",
              la.user_name as "userName",
              la.created_at as "lastActivity",
              EXTRACT(DAY FROM NOW() - la.created_at)::int as "inactiveDays"
       FROM last_activity la
       WHERE la.created_at < NOW() - ($1 || ' days')::interval
         AND la.room_id NOT IN (SELECT room_id FROM room_blocks WHERE is_active = true)
         AND la.room_id NOT IN (SELECT room_id FROM proactive_messages WHERE status = 'pending')`,
      [inactiveDays]
    );
  }
}
