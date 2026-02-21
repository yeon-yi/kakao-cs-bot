import { z } from 'zod';
import Redis from 'ioredis';
import { router, protectedProcedure } from '../trpc';
import { EscalationRepository, KnowledgeRepository, ConversationRepository, query } from '@kakao-cs-bot/database';
import { embedder, aiGateway, humanizer } from '@kakao-cs-bot/ai';
import { getEnv, createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:escalation');
const escalationRepo = new EscalationRepository();
const knowledgeRepo = new KnowledgeRepository();
const conversationRepo = new ConversationRepository();

let redis: Redis | null = null;
function getRedis() {
  if (!redis) {
    redis = new Redis(getEnv().REDIS_URL);
    redis.on('error', (err) => logger.warn('Redis connection error', { error: String(err) }));
  }
  return redis;
}

const statusEnum = z.enum(['pending', 'assigned', 'answered', 'learned', 'dismissed']);

const assigneesRouter = router({
  list: protectedProcedure.query(async () => {
    return escalationRepo.getAssignees();
  }),

  add: protectedProcedure
    .input(z.object({
      category: z.string().min(1),
      staffId: z.number(),
      roomId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await escalationRepo.addAssignee(input.category, input.staffId, input.roomId);
      return { success: true, data: result };
    }),

  // 하위호환: set → add 로 redirect
  set: protectedProcedure
    .input(z.object({
      category: z.string().min(1),
      staffId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const result = await escalationRepo.addAssignee(input.category, input.staffId);
      return { success: true, data: result };
    }),

  removeById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await escalationRepo.removeAssigneeById(input.id);
      return { success: true };
    }),

  remove: protectedProcedure
    .input(z.object({ category: z.string() }))
    .mutation(async ({ input }) => {
      await escalationRepo.removeAssigneesByCategory(input.category);
      return { success: true };
    }),
});

export const escalationRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: statusEnum.optional(),
      category: z.string().optional(),
      escalationType: z.string().optional(),
      offset: z.number().default(0),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      return escalationRepo.list(input);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const escalation = await escalationRepo.getById(input.id);
      if (!escalation) throw new Error('Escalation not found');
      return escalation;
    }),

  answer: protectedProcedure
    .input(z.object({
      id: z.number(),
      answer: z.string().min(5),
      category: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Update escalation with answer
      const escalation = await escalationRepo.getById(input.id);
      if (!escalation) throw new Error('Escalation not found');

      await escalationRepo.answer(input.id, input.answer, ctx.userId || 'admin');

      // 2. Auto-learn: add to knowledge base as Tier 1
      const embedding = await embedder.embed(escalation.user_message);

      const existing = await knowledgeRepo.search(embedding, escalation.user_message, { limit: 1 });
      let knowledgeId: string;

      if (existing.length > 0 && existing[0].similarity > 0.95) {
        await knowledgeRepo.update(existing[0].id, { answer: input.answer });
        knowledgeId = existing[0].id;
      } else {
        const knowledge = await knowledgeRepo.add({
          question: escalation.user_message,
          answer: input.answer,
          category: input.category || escalation.category || '일반',
          tier: 1,
          taught_by: ctx.userId || 'admin',
          tags: ['에스컬레이션', '피드백'],
          embedding: embedding as any,
        });
        knowledgeId = knowledge.id;
      }

      // 3. Mark as learned
      await escalationRepo.markLearned(input.id, knowledgeId);

      // 4. 질문 변형 생성 (비동기, 실패해도 무시)
      generateQuestionVariations(escalation.user_message, input.answer, knowledgeId, input.category || escalation.category || '일반', ctx.userId || 'admin').catch(err => {
        logger.warn('Question variation generation failed', { error: String(err) });
      });

      // 5. AI 이해도 검증 생성
      let aiInterpretation: string | null = null;
      try {
        aiInterpretation = await generateInterpretation(escalation.user_message, input.answer);
        if (aiInterpretation) {
          await knowledgeRepo.update(knowledgeId, {
            ai_interpretation: aiInterpretation,
            verification_status: 'pending_review',
          } as any);
        }
      } catch (err) {
        logger.warn('AI interpretation generation failed', { error: String(err) });
      }

      // 6. Publish event for bot to auto-reply in Kakao (인간화된 답변)
      try {
        // 대화 히스토리로 자연스러운 답변 생성
        let humanizedAnswer = input.answer;
        try {
          const history = await conversationRepo.getHistory(escalation.room_id, escalation.user_name || '', 3);
          const historyContext = history?.reverse().map((h: any) => {
            const parts: string[] = [];
            if (h.user_message) parts.push(`[고객] ${h.user_message}`);
            if (h.bot_response) parts.push(`[나] ${h.bot_response}`);
            return parts.join('\n');
          }).join('\n') || '';

          const response = await aiGateway.generate({
            prompt: `고객이 "${escalation.user_message}" 이라고 물었고, 답변 내용은 다음과 같습니다:
"${input.answer}"

위 내용을 바탕으로, 이전 대화를 이어가는 듯한 자연스러운 답변을 작성하세요.
프로페셔널한 ~합니다 체를 사용하고, 2~3문장으로 간결하게 작성하세요.`,
            systemPrompt: `광고 대행사 CS 담당자입니다. 고객에게 확인한 내용을 전달하고 있습니다.
이전 대화: ${historyContext || '(없음)'}
규칙: AI임을 밝히지 말 것, ~합니다 체 사용, 간결하게`,
            temperature: 0.3,
            complexity: 'simple',
          });
          humanizedAnswer = humanizer.humanizeResponse(response.text, { isThankYou: false });
        } catch {
          humanizedAnswer = humanizer.humanizeResponse(input.answer, { isThankYou: false });
        }

        await getRedis().publish('escalation:answered', JSON.stringify({
          escalationId: escalation.id,
          roomId: escalation.room_id,
          userName: escalation.user_name,
          question: escalation.user_message,
          answer: humanizedAnswer,
        }));
        await escalationRepo.markReplied(input.id);
      } catch (err) {
        logger.warn('Failed to publish escalation reply event', { error: String(err) });
      }

      // 7. 불확실 주제 해결 처리
      try {
        await query(
          `UPDATE uncertainty_topics SET status = 'addressed', resolved_knowledge_id = $1, resolved_at = NOW()
           WHERE status = 'open' AND category = $2
           AND similarity(topic, $3) > 0.5`,
          [knowledgeId, input.category || escalation.category || '일반', escalation.user_message]
        );
      } catch {}

      logger.info('Escalation answered and learned', { id: input.id, knowledgeId });
      return { success: true, knowledgeId, aiInterpretation };
    }),

  // 피드백 검증 확인/수정
  verify: protectedProcedure
    .input(z.object({
      knowledgeId: z.string(),
      status: z.enum(['verified', 'needs_correction']),
    }))
    .mutation(async ({ input, ctx }) => {
      await knowledgeRepo.update(input.knowledgeId, {
        verification_status: input.status,
        verified_by: ctx.userId || 'admin',
        verified_at: new Date().toISOString(),
      } as any);
      return { success: true };
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await escalationRepo.dismiss(input.id);
      return { success: true };
    }),

  pendingCount: protectedProcedure.query(async () => {
    const count = await escalationRepo.pendingCount();
    return { count };
  }),

  assignees: assigneesRouter,

  staffList: protectedProcedure.query(async () => {
    return query('SELECT id, real_name, department, kakao_name FROM company_staff WHERE is_active = true ORDER BY real_name');
  }),
});

// ===================== 질문 변형 생성 =====================
async function generateQuestionVariations(
  originalQuestion: string, answer: string,
  parentKnowledgeId: string, category: string, taughtBy: string
): Promise<void> {
  const response = await aiGateway.generate({
    prompt: `원래 질문: "${originalQuestion}"
답변: "${answer}"

위 질문을 다른 고객이 물어볼 수 있는 변형을 3개 만들어주세요.
같은 의미이지만 다른 표현을 사용하세요. 한 줄에 하나씩, 번호 없이 작성하세요.`,
    systemPrompt: '질문 변형 생성기입니다. 변형된 질문만 출력하세요.',
    temperature: 0.7,
    complexity: 'simple',
  });

  const variations = response.text.split('\n')
    .map(v => v.trim().replace(/^\d+[.)]\s*/, '').replace(/^[-•]\s*/, ''))
    .filter(v => v.length > 5 && v.length < 200);

  for (const variation of variations.slice(0, 3)) {
    try {
      const varEmbedding = await embedder.embed(variation);

      // 이미 비슷한 지식이 있으면 건너뛰기
      const existing = await knowledgeRepo.search(varEmbedding, variation, { limit: 1 });
      if (existing.length > 0 && existing[0].similarity > 0.9) continue;

      await knowledgeRepo.add({
        question: variation,
        answer,
        category,
        tier: 1,
        taught_by: taughtBy,
        tags: ['변형', '자동생성'],
        embedding: varEmbedding as any,
        parent_knowledge_id: parentKnowledgeId,
      } as any);
    } catch (err) {
      logger.warn('Failed to add variation', { variation, error: String(err) });
    }
  }
}

// ===================== AI 이해도 검증 생성 =====================
async function generateInterpretation(question: string, answer: string): Promise<string | null> {
  const response = await aiGateway.generate({
    prompt: `질문: "${question}"
답변: "${answer}"

위 Q&A에서 핵심 포인트를 정리해주세요.
- 고객이 알고 싶어하는 것
- 답변의 핵심 내용 (2~3줄)
- 주의사항이나 조건이 있다면 명시`,
    systemPrompt: '지식 검증기입니다. 핵심 포인트만 간결하게 정리하세요.',
    temperature: 0.2,
    complexity: 'simple',
  });

  return response.text.trim() || null;
}
