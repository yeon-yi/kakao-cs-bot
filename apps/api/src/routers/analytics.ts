import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { AnalyticsRepository, query as dbQuery, queryOne as dbQueryOne } from '@kakao-cs-bot/database';

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
        data: data.map((d: any) => ({
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

      const totals = data.reduce((acc: any, d: any) => ({
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

  today: protectedProcedure
    .query(async () => {
      // KST 기준 자정 (UTC+9)
      const nowKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const todayStart = new Date(nowKST);
      todayStart.setHours(0, 0, 0, 0);

      const stats = await dbQueryOne(
        `SELECT
           COUNT(*) as total_messages,
           COUNT(CASE WHEN bot_response IS NOT NULL THEN 1 END) as auto_responses,
           COUNT(DISTINCT room_id) as active_rooms,
           COUNT(DISTINCT user_name) as unique_users,
           AVG(response_time_ms) as avg_response_time,
           AVG(confidence) as avg_confidence
         FROM conversations
         WHERE created_at >= $1`,
        [todayStart.toISOString()]
      );

      const recentRooms = await dbQuery(
        `SELECT room_id, user_name, user_message, created_at
         FROM conversations
         WHERE created_at >= $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [todayStart.toISOString()]
      );

      const knowledgeCount = await dbQueryOne(
        'SELECT COUNT(*) as cnt FROM knowledge_base WHERE is_active = true',
        []
      );

      return {
        totalMessages: Number(stats?.total_messages ?? 0),
        autoResponses: Number(stats?.auto_responses ?? 0),
        activeRooms: Number(stats?.active_rooms ?? 0),
        uniqueUsers: Number(stats?.unique_users ?? 0),
        avgResponseTime: Math.round(Number(stats?.avg_response_time ?? 0)),
        avgConfidence: Number(stats?.avg_confidence ?? 0),
        recentRooms,
        knowledgeCount: Number(knowledgeCount?.cnt ?? 0),
      };
    }),

  // 학습률 분석
  learningRate: protectedProcedure
    .query(async () => {
      // 이번 주 신규 지식
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);

      const newKnowledge = await dbQueryOne(
        `SELECT COUNT(*) as cnt FROM knowledge_base WHERE created_at >= $1 AND is_active = true`,
        [weekStart.toISOString()]
      );

      // 이번 주 에스컬레이션
      const weekEscalations = await dbQueryOne(
        `SELECT COUNT(*) as total,
                COUNT(CASE WHEN status = 'learned' THEN 1 END) as learned
         FROM escalations WHERE created_at >= $1`,
        [weekStart.toISOString()]
      );

      // 지난 주와 비교
      const prevWeekStart = new Date();
      prevWeekStart.setDate(prevWeekStart.getDate() - 14);
      const prevWeekEscalations = await dbQueryOne(
        `SELECT COUNT(*) as total
         FROM escalations WHERE created_at >= $1 AND created_at < $2`,
        [prevWeekStart.toISOString(), weekStart.toISOString()]
      );

      // 검증 현황
      const verification = await dbQueryOne(
        `SELECT
           COUNT(*) as total,
           COUNT(CASE WHEN verification_status = 'verified' THEN 1 END) as verified,
           COUNT(CASE WHEN verification_status = 'needs_correction' THEN 1 END) as needs_correction,
           COUNT(CASE WHEN verification_status = 'unverified' THEN 1 END) as unverified
         FROM knowledge_base WHERE is_active = true`,
        []
      );

      // 평균 confidence
      const avgConfidence = await dbQueryOne(
        `SELECT AVG(confidence_score) as avg FROM knowledge_base WHERE is_active = true`,
        []
      );

      return {
        newKnowledgeThisWeek: Number(newKnowledge?.cnt ?? 0),
        escalationsThisWeek: Number(weekEscalations?.total ?? 0),
        learnedThisWeek: Number(weekEscalations?.learned ?? 0),
        escalationsTrend: Number(weekEscalations?.total ?? 0) - Number(prevWeekEscalations?.total ?? 0),
        verification: {
          total: Number(verification?.total ?? 0),
          verified: Number(verification?.verified ?? 0),
          needsCorrection: Number(verification?.needs_correction ?? 0),
          unverified: Number(verification?.unverified ?? 0),
        },
        avgConfidence: Number(avgConfidence?.avg ?? 0),
      };
    }),

  // 카테고리별 커버리지
  coverageGaps: protectedProcedure
    .query(async () => {
      const gaps = await dbQuery(
        `SELECT category,
                COUNT(*) as escalation_count,
                AVG(confidence) as avg_confidence
         FROM escalations
         WHERE created_at >= NOW() - INTERVAL '30 days'
         GROUP BY category
         ORDER BY COUNT(*) DESC
         LIMIT 10`,
        []
      );

      return gaps.map((g: any) => ({
        category: g.category || '미분류',
        escalationCount: Number(g.escalation_count),
        avgConfidence: Number(g.avg_confidence ?? 0),
      }));
    }),
});
