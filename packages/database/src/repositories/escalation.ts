import { query, queryOne, queryCount } from '../client';
import type { Database } from '../types';

type EscalationInsert = Database['public']['Tables']['escalations']['Insert'];

export class EscalationRepository {
  async create(input: EscalationInsert) {
    const row = await queryOne(
      `INSERT INTO escalations (conversation_id, room_id, user_id, user_name, user_message, bot_response, category, confidence, status, assigned_to, escalation_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.conversation_id ?? null, input.room_id, input.user_id,
        input.user_name ?? null, input.user_message, input.bot_response ?? null,
        input.category ?? null, input.confidence ?? null,
        input.status ?? 'pending', input.assigned_to ?? null,
        input.escalation_type ?? 'low_confidence',
      ]
    );
    return row;
  }

  async getById(id: number) {
    return queryOne('SELECT * FROM escalations WHERE id = $1', [id]);
  }

  async list(options?: { status?: string; category?: string; assignedTo?: number; offset?: number; limit?: number }) {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (options?.status) {
      conditions.push(`status = $${idx}`);
      values.push(options.status);
      idx++;
    }
    if (options?.category) {
      conditions.push(`category = $${idx}`);
      values.push(options.category);
      idx++;
    }
    if (options?.assignedTo) {
      conditions.push(`assigned_to = $${idx}`);
      values.push(options.assignedTo);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    const countValues = [...values];
    values.push(limit, offset);

    const data = await query(
      `SELECT * FROM escalations ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );

    const total = await queryCount(
      `SELECT COUNT(*) as count FROM escalations ${where}`,
      countValues
    );

    return { data, total };
  }

  async assign(id: number, staffId: number) {
    return queryOne(
      `UPDATE escalations SET assigned_to = $1, assigned_at = NOW(), status = 'assigned' WHERE id = $2 RETURNING *`,
      [staffId, id]
    );
  }

  async answer(id: number, answer: string, answeredBy: string) {
    return queryOne(
      `UPDATE escalations SET answer = $1, answered_by = $2, answered_at = NOW(), status = 'answered' WHERE id = $3 RETURNING *`,
      [answer, answeredBy, id]
    );
  }

  async markLearned(id: number, knowledgeId: string) {
    await query(
      `UPDATE escalations SET knowledge_id = $1, status = 'learned' WHERE id = $2`,
      [knowledgeId, id]
    );
  }

  async markReplied(id: number) {
    await query('UPDATE escalations SET replied_at = NOW() WHERE id = $1', [id]);
  }

  async dismiss(id: number) {
    await query(`UPDATE escalations SET status = 'dismissed' WHERE id = $1`, [id]);
  }

  async pendingCount() {
    return queryCount(
      `SELECT COUNT(*) as count FROM escalations WHERE status IN ('pending', 'assigned')`
    );
  }

  // Category assignees (다중 담당자 지원)
  async getAssignees() {
    return query(
      `SELECT ca.id, ca.category, ca.staff_id, ca.room_id,
              json_build_object('id', cs.id, 'real_name', cs.real_name, 'department', cs.department, 'kakao_name', cs.kakao_name) as company_staff
       FROM category_assignees ca
       JOIN company_staff cs ON cs.id = ca.staff_id
       ORDER BY ca.category, ca.room_id NULLS FIRST`
    );
  }

  async addAssignee(category: string, staffId: number, roomId?: string) {
    return queryOne(
      `INSERT INTO category_assignees (category, staff_id, room_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (category, staff_id, COALESCE(room_id, '')) DO NOTHING
       RETURNING *`,
      [category, staffId, roomId || null]
    );
  }

  async removeAssigneeById(id: number) {
    await query('DELETE FROM category_assignees WHERE id = $1', [id]);
  }

  async removeAssigneesByCategory(category: string) {
    await query('DELETE FROM category_assignees WHERE category = $1', [category]);
  }

  async getAssigneesByCategory(category: string, roomId?: string) {
    // 톡방별 담당자 우선, 없으면 전체(room_id IS NULL) 담당자
    const roomAssignees = roomId ? await query(
      `SELECT ca.*, json_build_object('id', cs.id, 'real_name', cs.real_name, 'kakao_name', cs.kakao_name) as company_staff
       FROM category_assignees ca
       JOIN company_staff cs ON cs.id = ca.staff_id
       WHERE ca.category = $1 AND ca.room_id = $2`,
      [category, roomId]
    ) : [];
    if (roomAssignees.length > 0) return roomAssignees;

    return query(
      `SELECT ca.*, json_build_object('id', cs.id, 'real_name', cs.real_name, 'kakao_name', cs.kakao_name) as company_staff
       FROM category_assignees ca
       JOIN company_staff cs ON cs.id = ca.staff_id
       WHERE ca.category = $1 AND ca.room_id IS NULL`,
      [category]
    );
  }

  // 하위호환: 단일 담당자 반환 (랜덤 선택)
  async getAssigneeByCategory(category: string, roomId?: string) {
    const assignees = await this.getAssigneesByCategory(category, roomId);
    if (assignees.length === 0) return null;
    return assignees[Math.floor(Math.random() * assignees.length)];
  }
}
