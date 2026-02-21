import { query, queryOne } from '../client';

export class UncertaintyRepository {
  async list(options?: { status?: string; category?: string; offset?: number; limit?: number }) {
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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    values.push(limit, offset);
    const data = await query(
      `SELECT * FROM uncertainty_topics ${where}
       ORDER BY occurrence_count DESC, last_seen_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );

    const countResult = await queryOne(
      `SELECT COUNT(*) as count FROM uncertainty_topics ${where}`,
      values.slice(0, -2)
    );

    return { data, total: parseInt(countResult?.count ?? '0', 10) };
  }

  async resolve(id: number, knowledgeId: string): Promise<void> {
    await query(
      `UPDATE uncertainty_topics SET status = 'addressed', resolved_knowledge_id = $1, resolved_at = NOW() WHERE id = $2`,
      [knowledgeId, id]
    );
  }

  async dismiss(id: number): Promise<void> {
    await query(`UPDATE uncertainty_topics SET status = 'dismissed' WHERE id = $1`, [id]);
  }

  async getStats() {
    const rows = await query(
      `SELECT status, COUNT(*) as count FROM uncertainty_topics GROUP BY status`,
      []
    );
    const stats: Record<string, number> = { open: 0, addressed: 0, dismissed: 0 };
    for (const r of rows) stats[r.status] = parseInt(r.count, 10);
    return stats;
  }

  async trending(limit = 10) {
    return query(
      `SELECT * FROM uncertainty_topics WHERE status = 'open'
       ORDER BY occurrence_count DESC, last_seen_at DESC LIMIT $1`,
      [limit]
    );
  }

  async openCount(): Promise<number> {
    const row = await queryOne(
      `SELECT COUNT(*) as count FROM uncertainty_topics WHERE status = 'open'`,
      []
    );
    return parseInt(row?.count ?? '0', 10);
  }
}
