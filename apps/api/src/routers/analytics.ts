import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { AnalyticsRepository } from '@kakao-cs-bot/database';

const analyticsRepo = new AnalyticsRepository();

export const analyticsRouter = router({
  daily: protectedProcedure
    .input(z.object({
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ input }) => {
      const data = await analyticsRepo.getDaily(input.startDate, input.endDate);
      return {
        data: data.map(d => ({
          date: d.date,
          totalMessages: d.total_messages,
          autoResponses: d.auto_responses,
          adminEscalations: d.admin_escalations,
          avgResponseTime: d.avg_response_time_ms,
          p95ResponseTime: d.p95_response_time_ms,
          aiCost: Number(d.total_ai_cost),
          accuracy: d.helpful_count + d.not_helpful_count > 0
            ? d.helpful_count / (d.helpful_count + d.not_helpful_count)
            : 0,
        })),
      };
    }),

  summary: protectedProcedure
    .query(async () => {
      const today = new Date().toISOString().slice(0, 10);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const data = await analyticsRepo.getDaily(thirtyDaysAgo, today);

      const totals = data.reduce((acc, d) => ({
        messages: acc.messages + d.total_messages,
        autoResponses: acc.autoResponses + d.auto_responses,
        escalations: acc.escalations + d.admin_escalations,
        cost: acc.cost + Number(d.total_ai_cost),
        helpful: acc.helpful + d.helpful_count,
        notHelpful: acc.notHelpful + d.not_helpful_count,
      }), { messages: 0, autoResponses: 0, escalations: 0, cost: 0, helpful: 0, notHelpful: 0 });

      return {
        period: { start: thirtyDaysAgo, end: today },
        totalMessages: totals.messages,
        autoResponseRate: totals.messages > 0 ? totals.autoResponses / totals.messages : 0,
        escalationRate: totals.messages > 0 ? totals.escalations / totals.messages : 0,
        totalCost: totals.cost,
        accuracy: totals.helpful + totals.notHelpful > 0
          ? totals.helpful / (totals.helpful + totals.notHelpful) : 0,
      };
    }),
});
