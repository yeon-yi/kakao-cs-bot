import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { ProactiveRepository } from '@kakao-cs-bot/database';
import { aiGateway, humanizer } from '@kakao-cs-bot/ai';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:proactive');
const proactiveRepo = new ProactiveRepository();

// 인사 메시지 템플릿 (AI가 랜덤하게 변형)
const GREETING_TEMPLATES = [
  '안녕하세요! 혹시 추가로 도움이 필요하신 부분 있으신가요?',
  '안녕하세요! 잘 지내고 계시죠? 문의사항이 있으시면 편하게 말씀해주세요.',
  '안녕하세요! 그동안 잘 진행되고 계신가요? 필요하신 부분 있으시면 언제든 알려주세요.',
];

const roomBlocksRouter = router({
  list: protectedProcedure
    .input(z.object({
      includeHistory: z.boolean().default(false),
      offset: z.number().default(0),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      if (input.includeHistory) {
        return proactiveRepo.listAllBlocks({ offset: input.offset, limit: input.limit });
      }
      return proactiveRepo.listBlocked({ offset: input.offset, limit: input.limit });
    }),

  block: protectedProcedure
    .input(z.object({
      roomId: z.string().min(1),
      userName: z.string().optional(),
      reason: z.string().default('해지요청'),
    }))
    .mutation(async ({ input, ctx }) => {
      // 차단 시 해당 방의 대기중인 인사 메시지도 취소
      await proactiveRepo.cancelByRoom(input.roomId);

      const block = await proactiveRepo.blockRoom({
        room_id: input.roomId,
        user_name: input.userName,
        reason: input.reason,
        blocked_by: ctx.userId || 'admin',
      });

      logger.info('Room blocked', { roomId: input.roomId, reason: input.reason });
      return { success: true, data: block };
    }),

  unblock: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ input }) => {
      await proactiveRepo.unblockRoom(input.roomId);
      logger.info('Room unblocked', { roomId: input.roomId });
      return { success: true };
    }),

  check: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .query(async ({ input }) => {
      const blocked = await proactiveRepo.isBlocked(input.roomId);
      return { blocked };
    }),
});

export const proactiveRouter = router({
  blocks: roomBlocksRouter,

  // 비활성 방 조회 (인사 메시지 생성 전 미리보기)
  inactiveRooms: protectedProcedure
    .input(z.object({
      inactiveDays: z.number().min(1).max(30).default(5),
    }))
    .query(async ({ input }) => {
      return proactiveRepo.findInactiveRooms(input.inactiveDays);
    }),

  // 자동 인사 메시지 생성 (비활성 방들에 대해)
  generateGreetings: protectedProcedure
    .input(z.object({
      inactiveDays: z.number().min(1).max(30).default(5),
    }))
    .mutation(async ({ input }) => {
      const inactiveRooms = await proactiveRepo.findInactiveRooms(input.inactiveDays);

      if (inactiveRooms.length === 0) {
        return { created: 0, rooms: [] };
      }

      const created: string[] = [];

      for (const room of inactiveRooms) {
        try {
          // AI로 자연스러운 인사 메시지 생성
          const template = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)];
          let greeting: string;

          try {
            const response = await aiGateway.generate({
              prompt: `다음 문안인사를 자연스럽게 변형해주세요. 원본 의미를 유지하면서 약간의 변화를 주세요.
친근하지만 프로페셔널하게, 2문장 이내로 작성하세요.
고객 이름: ${room.userName || '고객'}

원본: "${template}"

변형된 인사:`,
              systemPrompt: '광고 대행사 CS 담당자입니다. 간결하고 친근한 인사만 출력하세요.',
              temperature: 0.8,
              complexity: 'simple',
            });
            greeting = response.text.trim().replace(/^["']|["']$/g, '');
          } catch {
            greeting = template;
          }

          // 인간화 처리
          greeting = humanizer.humanizeResponse(greeting, { isThankYou: false });

          await proactiveRepo.createMessage({
            room_id: room.roomId,
            user_name: room.userName,
            message: greeting,
            message_type: 'greeting',
            last_activity: room.lastActivity,
            inactive_days: room.inactiveDays,
          });

          created.push(room.roomId);
        } catch (err) {
          logger.warn('Failed to create greeting', { roomId: room.roomId, error: String(err) });
        }
      }

      logger.info('Greetings generated', { count: created.length });
      return { created: created.length, rooms: created };
    }),

  // 대기중인 인사 메시지 목록 (봇 앱에서 폴링)
  pending: protectedProcedure
    .input(z.object({ limit: z.number().default(5) }))
    .query(async ({ input }) => {
      return proactiveRepo.getPendingMessages(input.limit);
    }),

  // 전송 결과 보고 (봇 앱에서 호출)
  reportSent: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await proactiveRepo.markSent(input.id);
      return { success: true };
    }),

  reportFailed: protectedProcedure
    .input(z.object({
      id: z.number(),
      error: z.string().default('unknown'),
    }))
    .mutation(async ({ input }) => {
      await proactiveRepo.markFailed(input.id, input.error);
      return { success: true };
    }),

  // 인사 메시지 이력 조회
  messages: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      offset: z.number().default(0),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      return proactiveRepo.listMessages(input);
    }),

  pendingCount: protectedProcedure.query(async () => {
    const count = await proactiveRepo.pendingCount();
    return { count };
  }),
});
