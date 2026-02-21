import { query, queryOne } from '../client';
import type { Database } from '../types';

type ConversationInsert = Database['public']['Tables']['conversations']['Insert'];

export class ConversationRepository {
  async create(input: ConversationInsert) {
    const row = await queryOne(
      `INSERT INTO conversations (room_id, user_id, user_name, user_message, bot_response, context, knowledge_tier, ai_model, confidence, was_helpful, response_time_ms, message_type, chain_steps)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        input.room_id, input.user_id, input.user_name ?? null,
        input.user_message, input.bot_response ?? null,
        input.context ? JSON.stringify(input.context) : null,
        input.knowledge_tier ?? null, input.ai_model ?? null,
        input.confidence ?? null, input.was_helpful ?? null,
        input.response_time_ms ?? null,
        input.message_type ?? 'text',
        input.chain_steps ?? null,
      ]
    );
    return row;
  }

  async getHistory(roomId: string, userId: string, limit = 20) {
    return query(
      'SELECT * FROM conversations WHERE room_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT $3',
      [roomId, userId, limit]
    );
  }

  async getRecent(limit = 50) {
    return query('SELECT * FROM conversations ORDER BY created_at DESC LIMIT $1', [limit]);
  }

  async markHelpful(id: number, helpful: boolean) {
    await query('UPDATE conversations SET was_helpful = $1 WHERE id = $2', [helpful, id]);
  }
}
