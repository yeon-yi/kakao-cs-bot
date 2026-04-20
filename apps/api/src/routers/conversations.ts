import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { query, queryOne } from '@kakao-cs-bot/database';

export const conversationsRouter = router({
  rooms: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      period: z.enum(['today', 'week', 'month', 'all']).default('all'),
      hasEscalation: z.boolean().optional(),
      hasStaff: z.boolean().optional(),
      offset: z.number().default(0),
      limit: z.number().min(1).max(100).default(30),
    }))
    .query(async ({ input }) => {
      const { search, period, hasEscalation, hasStaff, offset, limit } = input;
      const params: any[] = [];
      const conditions: string[] = [];

      // period → since
      const now = new Date();
      let since: Date | null = null;
      if (period === 'today') {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (period === 'week') {
        since = new Date(now.getTime() - 7 * 86_400_000);
      } else if (period === 'month') {
        since = new Date(now.getFullYear(), now.getMonth(), 1);
      }

      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(c.room_id ILIKE $${params.length} OR c.user_name ILIKE $${params.length})`);
      }

      if (since) {
        params.push(since);
        conditions.push(`c.created_at >= $${params.length}`);
      }

      if (hasEscalation) {
        conditions.push(`EXISTS (SELECT 1 FROM escalations e WHERE e.room_id = c.room_id)`);
      }

      if (hasStaff) {
        conditions.push(`EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = c.room_id AND rm.role = 'company_staff')`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await queryOne(
        `SELECT COUNT(DISTINCT room_id) as cnt FROM conversations c ${where}`,
        params
      );

      params.push(limit, offset);
      const data = await query(
        `SELECT
           c.room_id,
           COUNT(*) as message_count,
           MAX(c.user_name) as last_user_name,
           MAX(c.created_at) as last_message_at,
           (SELECT user_message FROM conversations c2 WHERE c2.room_id = c.room_id ORDER BY c2.created_at DESC LIMIT 1) as last_message
         FROM conversations c
         ${where}
         GROUP BY c.room_id
         ORDER BY MAX(c.created_at) DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return {
        data,
        total: Number(countResult?.cnt ?? 0),
      };
    }),

  messages: protectedProcedure
    .input(z.object({
      roomId: z.string(),
      limit: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const rows = await query(
        `SELECT id, room_id, user_name, user_message, bot_response, confidence, was_helpful, response_time_ms, message_type, chain_steps, ai_model, created_at
         FROM conversations
         WHERE room_id = $1
         ORDER BY created_at ASC
         LIMIT $2`,
        [input.roomId, input.limit]
      );

      const messages: any[] = [];
      for (const row of rows) {
        messages.push({
          id: `${row.id}-user`,
          role: 'user',
          content: row.user_message,
          user_name: row.user_name,
          message_type: row.message_type || 'text',
          created_at: row.created_at,
        });
        if (row.bot_response) {
          messages.push({
            id: `${row.id}-bot`,
            role: 'assistant',
            content: row.bot_response,
            confidence: row.confidence,
            response_time_ms: row.response_time_ms,
            ai_model: row.ai_model,
            chain_steps: row.chain_steps,
            created_at: row.created_at,
          });
        }
      }

      return { data: messages };
    }),
});
