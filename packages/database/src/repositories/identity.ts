import { query, queryOne } from '../client';

export class IdentityRepository {
  async findStaffByKakaoId(kakaoUserId: string) {
    return queryOne(
      'SELECT * FROM company_staff WHERE kakao_user_id = $1 AND is_active = true',
      [kakaoUserId]
    );
  }

  async findStaffByAlias(alias: string) {
    const row = await queryOne(
      `SELECT sa.id, sa.staff_id, sa.alias, sa.platform,
              row_to_json(cs.*) as staff
       FROM staff_aliases sa
       JOIN company_staff cs ON cs.id = sa.staff_id
       WHERE sa.alias = $1`,
      [alias]
    );
    return row;
  }

  async getRoomMember(roomId: string, userId: string) {
    return queryOne(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
  }

  async upsertRoomMember(roomId: string, userId: string, userName: string | null, role: string, confidence: number) {
    const row = await queryOne(
      `INSERT INTO room_members (room_id, user_id, user_name, role, confidence)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (room_id, user_id) DO UPDATE SET
         user_name = COALESCE(EXCLUDED.user_name, room_members.user_name),
         role = EXCLUDED.role,
         confidence = EXCLUDED.confidence
       RETURNING *`,
      [roomId, userId, userName, role, confidence]
    );
    return row;
  }

  async confirmIdentity(userId: string, roomId: string, role: string, confirmedBy: string) {
    await query(
      'UPDATE room_members SET role = $1, confirmed_by = $2, confidence = 1.0 WHERE room_id = $3 AND user_id = $4',
      [role, confirmedBy, roomId, userId]
    );
  }

  async listUnconfirmed() {
    return query(
      "SELECT * FROM room_members WHERE role = 'unknown' ORDER BY joined_at DESC"
    );
  }

  async listMembers(options: { role?: string; search?: string; offset?: number; limit?: number }) {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (options.role && options.role !== 'all') {
      conditions.push(`rm.role = $${idx}`);
      values.push(options.role);
      idx++;
    }
    if (options.search) {
      conditions.push(`(rm.user_name ILIKE $${idx} OR rm.room_id ILIKE $${idx})`);
      values.push(`%${options.search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const [rows, countRow] = await Promise.all([
      query(
        `SELECT rm.*,
                EXISTS(SELECT 1 FROM company_staff cs WHERE cs.kakao_name = rm.user_name AND cs.is_active = true) as has_staff_match
         FROM room_members rm ${where}
         ORDER BY rm.updated_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      ),
      queryOne(
        `SELECT COUNT(*)::int as total FROM room_members rm ${where}`,
        values
      ),
    ]);

    return { data: rows, total: countRow?.total || 0 };
  }

  async getNameCollisions() {
    return query(
      `SELECT rm.id, rm.room_id, rm.user_id, rm.user_name, rm.role, rm.confidence, rm.confirmed_by, rm.updated_at,
              cs.id as staff_id, cs.real_name as staff_real_name, cs.kakao_name as staff_kakao_name, cs.department
       FROM room_members rm
       JOIN company_staff cs ON (cs.kakao_name = rm.user_name OR cs.real_name = rm.user_name) AND cs.is_active = true
       WHERE rm.role = 'advertiser'
       ORDER BY rm.updated_at DESC`
    );
  }

  // 다른 방에서 이미 company_staff로 확인된 사용자인지 체크
  async isKnownStaff(userName: string): Promise<boolean> {
    const row = await queryOne(
      `SELECT 1 FROM room_members WHERE user_name = $1 AND role = 'company_staff' AND confidence >= 0.9 LIMIT 1`,
      [userName]
    );
    return !!row;
  }

  async registerStaff(input: { kakao_user_id?: string; kakao_name?: string; real_name: string; email?: string; phone?: string; department?: string; position?: string; added_by?: string }) {
    const row = await queryOne(
      `INSERT INTO company_staff (kakao_user_id, kakao_name, real_name, email, phone, department, position, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.kakao_user_id ?? null, input.kakao_name ?? null,
        input.real_name, input.email ?? null, input.phone ?? null,
        input.department ?? null, input.position ?? null, input.added_by ?? null,
      ]
    );
    return row;
  }
}
