import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { KnowledgeRepository } from '@kakao-cs-bot/database';
import { aiGateway, embedder } from '@kakao-cs-bot/ai';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:upload');
const knowledgeRepo = new KnowledgeRepository();

interface ExtractedKnowledge {
  question: string;
  answer: string;
  category: string;
  tags: string[];
}

export const uploadRouter = router({
  /**
   * 텍스트 내용을 AI가 분석하여 Q&A 쌍으로 추출 후 자동 등록
   * PDF/엑셀 파싱은 프론트엔드에서 텍스트로 변환 후 전송
   */
  processText: protectedProcedure
    .input(z.object({
      content: z.string().min(10).max(50000),
      source: z.string().min(1).max(200),
      category: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const start = Date.now();

      // GPT-4o로 지식 추출 (복잡한 작업)
      const systemPrompt = `당신은 문서에서 고객 상담에 유용한 Q&A를 추출하는 전문가입니다.

주어진 텍스트를 분석하여 고객이 자주 물어볼 만한 질문과 답변 쌍을 추출하세요.

규칙:
1. 각 Q&A는 독립적이고 완결된 내용이어야 합니다
2. 답변은 정확하고 친절한 톤으로 작성하세요
3. 질문은 고객 관점에서 자연스럽게 작성하세요
4. 카테고리와 관련 태그도 함께 추출하세요
5. 최소 3개, 최대 15개의 Q&A를 추출하세요

반드시 아래 JSON 형식으로만 응답하세요:
[
  {
    "question": "질문 내용",
    "answer": "답변 내용",
    "category": "카테고리",
    "tags": ["태그1", "태그2"]
  }
]`;

      const prompt = `아래 문서에서 Q&A를 추출하세요.\n\n문서 제목/출처: ${input.source}\n${input.category ? `기본 카테고리: ${input.category}\n` : ''}\n---\n${input.content}`;

      const response = await aiGateway.generate({
        prompt,
        systemPrompt,
        complexity: 'complex',
        temperature: 0.3,
        maxTokens: 4000,
      });

      let extracted: ExtractedKnowledge[];
      try {
        // JSON 부분만 파싱 (```json ... ``` 감싸진 경우도 처리)
        let jsonText = response.text;
        const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
        if (jsonMatch) jsonText = jsonMatch[0];
        extracted = JSON.parse(jsonText);
      } catch {
        logger.error('Failed to parse AI response', { text: response.text });
        throw new Error('AI 응답을 파싱할 수 없습니다. 다시 시도해 주세요.');
      }

      // 추출된 지식을 DB에 등록
      let added = 0;
      let skipped = 0;
      const results: Array<{ question: string; status: 'added' | 'skipped'; reason?: string }> = [];

      for (const item of extracted) {
        try {
          const embedding = await embedder.embed(item.question);

          // 중복 체크
          const existing = await knowledgeRepo.search(embedding, item.question, { limit: 1 });
          if (existing.length > 0 && existing[0].similarity > 0.9) {
            skipped++;
            results.push({ question: item.question, status: 'skipped', reason: `유사 항목 존재 (${Math.round(existing[0].similarity * 100)}%)` });
            continue;
          }

          await knowledgeRepo.add({
            question: item.question,
            answer: item.answer,
            category: input.category || item.category,
            tier: 2, // AI가 추출한 지식 = Tier 2
            source: input.source,
            taught_by: ctx.userId || 'file-upload',
            tags: item.tags || null,
            embedding: embedding as any,
          });
          added++;
          results.push({ question: item.question, status: 'added' });
        } catch (err) {
          skipped++;
          results.push({ question: item.question, status: 'skipped', reason: String(err) });
        }
      }

      logger.info('File processing complete', {
        source: input.source,
        extracted: extracted.length,
        added,
        skipped,
        processingTime: Date.now() - start,
        aiCost: response.cost,
      });

      return {
        success: true,
        extracted: extracted.length,
        added,
        skipped,
        results,
        aiModel: response.model,
        aiCost: response.cost,
        processingTime: Date.now() - start,
      };
    }),
});
