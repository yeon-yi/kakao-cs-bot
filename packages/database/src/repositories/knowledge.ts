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

  async add(input: KnowledgeInsert): Promise<KnowledgeRow> {
    const embeddingStr = input.embedding ? `[${input.embedding.join(',')}]` : null;
    const row = await queryOne<KnowledgeRow>(
      `INSERT INTO knowledge_base (tier, question, answer, category, embedding, source, taught_by, tags, notes, usage_count, confidence_score, is_active)
       VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        input.tier, input.question, input.answer ?? null, input.category ?? null,
        embeddingStr, input.source ?? null, input.taught_by ?? null,
        input.tags ?? null, input.notes ?? null,
        input.usage_count ?? 0, input.confidence_score ?? 1.0, input.is_active ?? true,
      ]
    );
    return row!;
  }

  async update(id: string, updates: Partial<KnowledgeInsert>): Promise<KnowledgeRow> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
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
    return row!;
  }

  async delete(id: string): Promise<void> {
    await query('UPDATE knowledge_base SET is_active = false WHERE id = $1', [id]);
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
