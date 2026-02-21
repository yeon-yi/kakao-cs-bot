import { query, queryOne } from '../client';
import type { Database } from '../types';

type KnowledgeRow = Database['public']['Tables']['knowledge_base']['Row'];
type KnowledgeInsert = Database['public']['Tables']['knowledge_base']['Insert'];

export class KnowledgeRepository {
  async search(embedding: number[], text: string, options?: { tier?: number; category?: string; limit?: number }) {
    const rows = await query(
      `SELECT * FROM search_knowledge($1::vector, $2, $3, $4, $5)`,
      [
        `[${embedding.join(',')}]`,
        text,
        options?.tier ?? null,
        options?.category ?? null,
        options?.limit ?? 5,
      ]
    );
    return rows;
  }

  async getById(id: string): Promise<KnowledgeRow | null> {
    return queryOne<KnowledgeRow>('SELECT * FROM knowledge_base WHERE id = $1', [id]);
  }

  async add(input: KnowledgeInsert & { parent_knowledge_id?: string }): Promise<KnowledgeRow> {
    const embeddingStr = input.embedding ? `[${input.embedding.join(',')}]` : null;
    const row = await queryOne<KnowledgeRow>(
      `INSERT INTO knowledge_base (tier, question, answer, category, embedding, source, taught_by, tags, notes, usage_count, confidence_score, is_active, parent_knowledge_id)
       VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        input.tier, input.question, input.answer ?? null, input.category ?? null,
        embeddingStr, input.source ?? null, input.taught_by ?? null,
        input.tags ?? null, input.notes ?? null,
        input.usage_count ?? 0, input.confidence_score ?? 1.0, input.is_active ?? true,
        input.parent_knowledge_id ?? null,
      ]
    );

    // history 기록
    this.recordHistory(row!.id, 'add', null, null, input.question, input.answer ?? null, input.taught_by || 'system');

    return row!;
  }

  private static ALLOWED_COLUMNS = new Set([
    'question', 'answer', 'category', 'tier', 'tags', 'notes', 'embedding',
    'is_active', 'confidence_score', 'usage_count', 'source', 'taught_by',
    'parent_knowledge_id', 'verification_status', 'ai_interpretation',
    'verified_by', 'verified_at',
  ]);

  async update(id: string, updates: Partial<KnowledgeInsert>): Promise<KnowledgeRow> {
    // 변경 전 상태 조회 (history용)
    const prev = await this.getById(id);

    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (!KnowledgeRepository.ALLOWED_COLUMNS.has(key)) continue;
      if (key === 'embedding' && value != null) {
        setClauses.push(`${key} = $${idx}::vector`);
        values.push(`[${(value as number[]).join(',')}]`);
      } else {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
      }
      idx++;
    }

    values.push(id);
    const row = await queryOne<KnowledgeRow>(
      `UPDATE knowledge_base SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    // history 기록 (질문 또는 답변이 변경된 경우)
    if (updates.question || updates.answer) {
      this.recordHistory(
        id, 'update',
        prev?.question ?? null, prev?.answer ?? null,
        (updates.question as string) ?? prev?.question ?? null,
        (updates.answer as string) ?? prev?.answer ?? null,
        'admin',
      );
    }

    return row!;
  }

  async delete(id: string): Promise<void> {
    const prev = await this.getById(id);
    await query('UPDATE knowledge_base SET is_active = false WHERE id = $1', [id]);
    this.recordHistory(id, 'delete', prev?.question ?? null, prev?.answer ?? null, null, null, 'admin');
  }

  async bulkDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    await query(
      `UPDATE knowledge_base SET is_active = false WHERE id IN (${placeholders})`,
      ids
    );
  }

  async incrementUsage(id: string): Promise<void> {
    await query('UPDATE knowledge_base SET usage_count = usage_count + 1 WHERE id = $1', [id]);
  }

  async adjustConfidence(id: string, delta: number): Promise<void> {
    await query(
      'UPDATE knowledge_base SET confidence_score = GREATEST(0.1, LEAST(1.0, confidence_score + $1)) WHERE id = $2',
      [delta, id]
    );
  }

  private recordHistory(
    knowledgeId: string, action: string,
    prevQ: string | null, prevA: string | null,
    newQ: string | null, newA: string | null,
    changedBy: string,
  ): void {
    query(
      `INSERT INTO knowledge_history (knowledge_id, action, previous_question, previous_answer, new_question, new_answer, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [knowledgeId, action, prevQ, prevA, newQ, newA, changedBy]
    ).catch(() => {}); // fire-and-forget
  }

  async list(options?: { tier?: number; category?: string; offset?: number; limit?: number }) {
    const conditions: string[] = ['is_active = true'];
    const values: any[] = [];
    let idx = 1;

    if (options?.tier) {
      conditions.push(`tier = $${idx}`);
      values.push(options.tier);
      idx++;
    }
    if (options?.category) {
      conditions.push(`category = $${idx}`);
      values.push(options.category);
      idx++;
    }

    const where = conditions.join(' AND ');
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    values.push(limit, offset);
    const data = await query<KnowledgeRow>(
      `SELECT * FROM knowledge_base WHERE ${where} ORDER BY updated_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM knowledge_base WHERE ${where}`,
      values.slice(0, -2)
    );

    return { data, total: parseInt(countResult?.count ?? '0', 10) };
  }
}
