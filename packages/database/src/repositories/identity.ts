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
