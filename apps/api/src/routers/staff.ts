import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { query, queryOne } from '@kakao-cs-bot/database';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:staff');

export const staffRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      activeOnly: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (input.activeOnly) {
        conditions.push(`is_active = true`);
      }
      if (input.search) {
        conditions.push(`(real_name ILIKE $${idx} OR kakao_name ILIKE $${idx} OR department ILIKE $${idx})`);
        values.push(`%${input.search}%`);
        idx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      return query(`SELECT * FROM company_staff ${where} ORDER BY real_name`, values);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return queryOne('SELECT * FROM company_staff WHERE id = $1', [input.id]);
    }),

  create: protectedProcedure
    .input(z.object({
      realName: z.string().min(1, '이름을 입력하세요'),
      kakaoName: z.string().optional(),
      kakaoUserId: z.string().optional(),
      kakaoRoomId: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().optional(),
      department: z.string().optional(),
      position: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const data = await queryOne(
        `INSERT INTO company_staff (real_name, kakao_name, kakao_user_id, kakao_room_id, email, phone, department, position, added_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          input.realName, input.kakaoName || null, input.kakaoUserId || null,
          input.kakaoRoomId || null, input.email || null, input.phone || null,
          input.department || null, input.position || null, ctx.userId,
        ]
      );
      logger.info('Staff created', { id: data.id, name: input.realName });
      return data;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      realName: z.string().min(1).optional(),
      kakaoName: z.string().optional(),
      kakaoUserId: z.string().optional(),
      kakaoRoomId: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().optional(),
      department: z.string().optional(),
      position: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      const setClauses: string[] = [];
      const values: any[] = [];
      let idx = 1;

      const fieldMap: Record<string, string> = {
        realName: 'real_name', kakaoName: 'kakao_name', kakaoUserId: 'kakao_user_id',
        kakaoRoomId: 'kakao_room_id',
        email: 'email', phone: 'phone', department: 'department', position: 'position',
      };

      for (const [key, dbCol] of Object.entries(fieldMap)) {
        if ((updates as any)[key] !== undefined) {
          setClauses.push(`${dbCol} = $${idx}`);
          values.push((updates as any)[key] || null);
          idx++;
        }
      }

      if (setClauses.length === 0) return queryOne('SELECT * FROM company_staff WHERE id = $1', [id]);

      values.push(id);
      const data = await queryOne(
        `UPDATE company_staff SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      logger.info('Staff updated', { id });
      return data;
    }),

  toggleActive: protectedProcedure
    .input(z.object({
      id: z.number(),
      isActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const data = await queryOne(
        'UPDATE company_staff SET is_active = $1 WHERE id = $2 RETURNING *',
        [input.isActive, input.id]
      );
      logger.info('Staff toggled', { id: input.id, isActive: input.isActive });
      return data;
    }),
});
