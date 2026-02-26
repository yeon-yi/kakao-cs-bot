import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { UncertaintyRepository, KnowledgeRepository } from '@kakao-cs-bot/database';
import { embedder, aiGateway } from '@kakao-cs-bot/ai';

const uncertaintyRepo = new UncertaintyRepository();
const knowledgeRepo = new KnowledgeRepository();

export const uncertaintyRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(['open', 'addressed', 'dismissed']).optional(),
      category: z.string().min(1).optional(),
      offset: z.number().default(0),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      return uncertaintyRepo.list(input);
    }),

  stats: protectedProcedure.query(async () => {
    return uncertaintyRepo.getStats();
  }),

  trending: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      return uncertaintyRepo.trending(input.limit);
    }),

  openCount: protectedProcedure.query(async () => {
    const count = await uncertaintyRepo.openCount();
    return { count };
  }),

  // 불확실 주제에 대해 바로 답변 등록 (지식 추가 + 주제 해결)
  resolve: protectedProcedure
    .input(z.object({
      id: z.number(),
      question: z.string().min(1),
      answer: z.string().min(5),
      category: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // 주제 존재/상태 사전 검증
      const topic = await uncertaintyRepo.list({ status: 'open', offset: 0, limit: 1 });
      // getById로 직접 확인
      const existing = await uncertaintyRepo.getById(input.id);
      if (!existing) throw new Error('주제를 찾을 수 없습니다');
      if (existing.status !== 'open') throw new Error('이미 처리된 주제입니다');

      const embedding = await embedder.embed(input.question);
      const knowledge = await knowledgeRepo.add({
        question: input.question,
        answer: input.answer,
        category: input.category || '일반',
        tier: 1,
        taught_by: ctx.userId || 'admin',
        tags: ['불확실해결'],
        embedding: embedding as any,
      });

      await uncertaintyRepo.resolve(input.id, knowledge.id);
      return { success: true, knowledgeId: knowledge.id };
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await uncertaintyRepo.dismiss(input.id);
      return { success: true };
    }),

  // AI 추천 답변 생성 (불확실 주제 기반)
  suggestAnswer: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const topic = await uncertaintyRepo.getById(input.id);
      if (!topic) throw new Error('주제를 찾을 수 없습니다');

      // 관련 지식 검색으로 컨텍스트 수집
      const embedding = await embedder.embed(topic.sample_question || topic.topic);
      const relatedKnowledge = await knowledgeRepo.search(embedding, topic.topic, { limit: 3 });

      const knowledgeContext = relatedKnowledge.length > 0
        ? relatedKnowledge.map(k => `Q: ${k.question}\nA: ${k.answer}`).join('\n\n')
        : '(관련 지식 없음)';

      const response = await aiGateway.generate({
        prompt: `불확실 주제: "${topic.sample_question || topic.topic}"
카테고리: ${topic.category || '일반'}
발생 횟수: ${topic.occurrence_count || 1}회

관련 참고 지식:
${knowledgeContext}

위 주제에 대한 CS 답변 초안을 작성해주세요.
- 광고 대행사 CS 담당자 관점에서 작성
- 2~4문장으로 간결하게
- ~합니다 체 사용
- 불확실한 부분은 "[확인 필요]"로 표시`,
        systemPrompt: '광고 대행사 CS 답변 초안 생성기입니다. 답변만 출력하세요.',
        temperature: 0.3,
        complexity: 'simple',
      });

      return {
        suggestedAnswer: response.text.trim(),
        relatedKnowledge: relatedKnowledge.map(k => ({
          id: k.id,
          question: k.question,
          answer: k.answer,
          similarity: k.similarity,
        })),
      };
    }),
});
