import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { contextAnalyzer } from '@kakao-cs-bot/ai';
import { ConversationRepository } from '@kakao-cs-bot/database';

const conversationRepo = new ConversationRepository();

export const contextRouter = router({
  analyze: publicProcedure
    .input(z.object({
      message: z.string().min(1),
      senderId: z.string(),
      senderRole: z.enum(['ADVERTISER', 'STAFF', 'UNKNOWN']),
      roomId: z.string(),
      history: z.array(z.object({
        senderId: z.string(),
        message: z.string(),
        timestamp: z.number(),
      })).optional(),
      hasMention: z.boolean().optional(),
      mentionTarget: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const result = await contextAnalyzer.analyze(input);
      return result;
    }),

  analyzeStaff: publicProcedure
    .input(z.object({
      message: z.string().min(1),
      senderId: z.string(),
      roomId: z.string(),
      history: z.array(z.object({
        senderId: z.string(),
        message: z.string(),
        timestamp: z.number(),
      })).optional(),
    }))
    .query(async ({ input }) => {
      const result = await contextAnalyzer.analyze({
        ...input,
        senderRole: 'STAFF',
      });

      // Detect patterns
      const patterns: string[] = [];
      if (/님|씨|고객님|광고주님/.test(input.message)) patterns.push('호칭어');
      if (/드립니다|해드립니다|부탁드립니다/.test(input.message)) patterns.push('안내어투');
      if (/시스템|프로그램|어디|어떻게/.test(input.message)) patterns.push('시스템질문');

      return {
        messageType: result.target,
        shouldBotRespond: result.shouldRespond,
        confidence: result.confidence,
        detectedPatterns: patterns,
      };
    }),

  getHistory: publicProcedure
    .input(z.object({
      roomId: z.string(),
      userId: z.string(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      return conversationRepo.getHistory(input.roomId, input.userId, input.limit);
    }),
});
