import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { getSupabaseAdmin } from '@kakao-cs-bot/database';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:staff');

export const staffRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      activeOnly: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      const db = getSupabaseAdmin();
      let query = db.from('company_staff').select('*');
      if (input.activeOnly) query = query.eq('is_active', true);
      if (input.search) {
        query = query.or(`real_name.ilike.%${input.search}%,kakao_name.ilike.%${input.search}%,department.ilike.%${input.search}%`);
      }
      query = query.order('real_name');
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getSupabaseAdmin();
      const { data, error } = await db.from('company_staff').select('*').eq('id', input.id).single();
      if (error) throw error;
      return data;
    }),

  create: protectedProcedure
    .input(z.object({
      realName: z.string().min(1, '이름을 입력하세요'),
      kakaoName: z.string().optional(),
      kakaoUserId: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().optional(),
      department: z.string().optional(),
      position: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getSupabaseAdmin();
      const { data, error } = await db.from('company_staff').insert({
        real_name: input.realName,
        kakao_name: input.kakaoName || null,
        kakao_user_id: input.kakaoUserId || null,
        email: input.email || null,
        phone: input.phone || null,
        department: input.department || null,
        position: input.position || null,
        added_by: ctx.userId,
      }).select().single();
      if (error) throw error;
      logger.info('Staff created', { id: data.id, name: input.realName });
      return data;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      realName: z.string().min(1).optional(),
      kakaoName: z.string().optional(),
      kakaoUserId: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().optional(),
      department: z.string().optional(),
      position: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getSupabaseAdmin();
      const { id, ...updates } = input;
      const dbUpdates: Record<string, unknown> = {};
      if (updates.realName !== undefined) dbUpdates.real_name = updates.realName;
      if (updates.kakaoName !== undefined) dbUpdates.kakao_name = updates.kakaoName || null;
      if (updates.kakaoUserId !== undefined) dbUpdates.kakao_user_id = updates.kakaoUserId || null;
      if (updates.email !== undefined) dbUpdates.email = updates.email || null;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone || null;
      if (updates.department !== undefined) dbUpdates.department = updates.department || null;
      if (updates.position !== undefined) dbUpdates.position = updates.position || null;

      const { data, error } = await db.from('company_staff').update(dbUpdates).eq('id', id).select().single();
      if (error) throw error;
      logger.info('Staff updated', { id });
      return data;
    }),

  toggleActive: protectedProcedure
    .input(z.object({
      id: z.number(),
      isActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = getSupabaseAdmin();
      const { data, error } = await db.from('company_staff').update({ is_active: input.isActive }).eq('id', input.id).select().single();
      if (error) throw error;
      logger.info('Staff toggled', { id: input.id, isActive: input.isActive });
      return data;
    }),
});
