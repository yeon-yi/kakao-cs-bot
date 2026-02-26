import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { TRPCError } from '@trpc/server';
import { KnowledgeRepository, ConfigRepository } from '@kakao-cs-bot/database';
import { aiGateway, embedder } from '@kakao-cs-bot/ai';

const knowledgeRepo = new KnowledgeRepository();
const configRepo = new ConfigRepository();

const PARSE_SYSTEM_PROMPT = `당신은 카카오톡 대화 분석 전문가입니다.
주어진 카카오톡 대화 텍스트를 분석하여 다음을 추출해야 합니다:

1. **대화 파싱**: 카카오톡 대화 형식을 인식합니다.
   - "[이름] [HH:MM]" 형식 (예: "[김상담] [14:30] 안녕하세요")
   - "[이름] [오후 H:MM]" 형식 (예: "[김상담] [오후 2:30] 안녕하세요")
   - "이름 : 메시지" 형식
   - 날짜 구분선 ("---- 2024년 1월 1일 월요일 ----" 등)
   - 연속된 메시지는 같은 화자의 메시지로 합칩니다.

2. **화자 구분**: 누가 상담원(직원)이고 누가 고객인지 판별합니다.
   - 상담원 특징: 존댓말 사용, "대표님/고객님" 호칭, 업무 관련 안내, 전문 용어 사용
   - 고객 특징: 질문 위주, 반말 또는 짧은 문장, 불만/요청 표현

3. **Q&A 쌍 추출**: 고객이 질문/요청하고 상담원이 답변한 쌍을 추출합니다.
   - question: 고객이 물어본 내용 (핵심만 정리)
   - answer: 상담원의 답변 (핵심만 정리, 원문 말투 유지)
   - category: 질문 카테고리 (예: "광고비", "계약", "성과", "일반문의", "불만처리", "기술지원" 등)
   - confidence: 추출 신뢰도 0.0~1.0 (명확한 Q&A면 높게, 추론이면 낮게)

4. **말투/톤 분석**: 상담원의 커뮤니케이션 스타일을 분석합니다.
   - patterns: 자주 사용하는 표현/패턴 목록 (예: "~해 드리겠습니다", "확인 후 안내~", "감사합니다")
   - style: 전체적인 스타일 설명 (예: "정중하고 프로페셔널한 존댓말체, 간결한 문장")
   - examples: 상담원의 실제 메시지 중 스타일을 잘 보여주는 예시 3~5개
   - sentenceEndings: 자주 쓰는 문장 끝 패턴 (예: ["~입니다", "~드리겠습니다", "~부탁드립니다"])
   - honorifics: 사용하는 호칭 (예: ["대표님", "고객님"])
   - messageLength: 평균 메시지 길이 ("short" | "medium" | "long")
   - formalityLevel: 격식 수준 ("formal" | "semi-formal" | "casual")
   - emojiUsage: 이모지/이모티콘 사용 빈도 ("none" | "rare" | "frequent")

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요:
{
  "pairs": [
    {
      "question": "고객 질문",
      "answer": "상담원 답변",
      "category": "카테고리",
      "confidence": 0.9
    }
  ],
  "toneProfile": {
    "patterns": ["패턴1", "패턴2"],
    "style": "스타일 설명",
    "examples": ["예시 메시지1", "예시 메시지2"],
    "sentenceEndings": ["~입니다", "~드리겠습니다"],
    "honorifics": ["대표님"],
    "messageLength": "medium",
    "formalityLevel": "formal",
    "emojiUsage": "rare"
  }
}`;

export const learningRouter = router({
  /**
   * 카카오톡 대화 텍스트를 파싱하여 Q&A 쌍과 톤 프로필을 추출
   */
  parseConversation: protectedProcedure
    .input(z.object({
      text: z.string().min(10, '대화 텍스트가 너무 짧습니다'),
      source: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const userPrompt = `다음 카카오톡 대화를 분석해주세요:\n\n${input.text}`;

      const response = await aiGateway.generate({
        prompt: userPrompt,
        systemPrompt: PARSE_SYSTEM_PROMPT,
        temperature: 0.1,
        maxTokens: 4000,
        complexity: 'complex',
        jsonMode: true,
      });

      // AI 응답에서 JSON 추출 (다중 폴백 전략)
      let parsed: any;
      try {
        const text = response.text.trim();

        // 1순위: 직접 JSON 파싱 (jsonMode 덕분에 대부분 여기서 성공)
        try {
          parsed = JSON.parse(text);
        } catch {
          // 2순위: ```json ... ``` 코드블록에서 추출
          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[1].trim());
          } else {
            // 3순위: 텍스트 내 첫 번째 JSON 객체 추출 ({ ... })
            const objMatch = text.match(/\{[\s\S]*\}/);
            if (objMatch) {
              parsed = JSON.parse(objMatch[0]);
            } else {
              throw new Error('No JSON found in response');
            }
          }
        }
      } catch (parseError) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'AI 응답을 파싱할 수 없습니다. 대화 형식을 확인해주세요.',
        });
      }

      // 응답 구조 검증 및 정규화
      const pairs = Array.isArray(parsed.pairs) ? parsed.pairs.map((p: any) => ({
        question: String(p.question ?? ''),
        answer: String(p.answer ?? ''),
        category: String(p.category ?? '일반문의'),
        confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
      })) : [];

      const toneProfile = {
        patterns: Array.isArray(parsed.toneProfile?.patterns) ? parsed.toneProfile.patterns.map(String) : [],
        style: String(parsed.toneProfile?.style ?? ''),
        examples: Array.isArray(parsed.toneProfile?.examples) ? parsed.toneProfile.examples.map(String) : [],
        sentenceEndings: Array.isArray(parsed.toneProfile?.sentenceEndings) ? parsed.toneProfile.sentenceEndings.map(String) : [],
        honorifics: Array.isArray(parsed.toneProfile?.honorifics) ? parsed.toneProfile.honorifics.map(String) : [],
        messageLength: String(parsed.toneProfile?.messageLength ?? 'medium'),
        formalityLevel: String(parsed.toneProfile?.formalityLevel ?? 'formal'),
        emojiUsage: String(parsed.toneProfile?.emojiUsage ?? 'none'),
      };

      return { pairs, toneProfile };
    }),

  /**
   * 파싱된 Q&A 쌍을 knowledge_base에 저장하고, 톤 패턴을 config에 저장
   */
  applyLearning: protectedProcedure
    .input(z.object({
      pairs: z.array(z.object({
        question: z.string(),
        answer: z.string(),
        category: z.string().optional(),
      })),
      tonePatterns: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      let added = 0;
      let updated = 0;

      // Q&A 쌍을 knowledge_base에 저장
      for (const pair of input.pairs) {
        try {
          // 임베딩 생성
          const embedding = await embedder.embed(`${pair.question} ${pair.answer}`);

          // 유사한 기존 지식 검색
          const existing = await knowledgeRepo.search(embedding, pair.question, {
            category: pair.category,
            limit: 1,
          });

          if (existing.length > 0 && existing[0].similarity > 0.9) {
            // 높은 유사도의 기존 지식이 있으면 업데이트
            await knowledgeRepo.update(existing[0].id, {
              answer: pair.answer,
              category: pair.category,
              source: 'conversation_learning',
              embedding,
            });
            updated++;
          } else {
            // 새로운 지식 추가
            await knowledgeRepo.add({
              tier: 2,
              question: pair.question,
              answer: pair.answer,
              category: pair.category ?? '일반문의',
              embedding,
              source: 'conversation_learning',
              taught_by: 'learning_system',
              confidence_score: 0.8,
              is_active: true,
            });
            added++;
          }
        } catch (err) {
          // 개별 쌍 실패 시 계속 진행
          continue;
        }
      }

      // 톤 패턴 저장
      if (input.tonePatterns && input.tonePatterns.length > 0) {
        try {
          // 기존 톤 프로필 가져오기
          const existingProfile = await configRepo.get('learned.tone_profile');
          let currentPatterns: string[] = [];
          if (existingProfile?.value) {
            try {
              const parsed = typeof existingProfile.value === 'string'
                ? JSON.parse(existingProfile.value)
                : existingProfile.value;
              currentPatterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];
            } catch {}
          }

          // 중복 제거 후 병합
          const mergedPatterns = [...new Set([...currentPatterns, ...input.tonePatterns])];

          await configRepo.set('learned.tone_profile', {
            patterns: mergedPatterns,
            updatedAt: new Date().toISOString(),
          }, 'learning_system');
        } catch {
          // 톤 패턴 저장 실패는 무시
        }
      }

      return { added, updated };
    }),

  /**
   * 현재 학습된 톤 프로필 조회
   */
  getToneProfile: protectedProcedure
    .query(async () => {
      try {
        const config = await configRepo.get('learned.tone_profile');
        if (!config?.value) {
          return { patterns: [], style: '', examples: [], updatedAt: null };
        }

        const parsed = typeof config.value === 'string'
          ? JSON.parse(config.value)
          : config.value;

        return {
          patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
          style: String(parsed.style ?? ''),
          examples: Array.isArray(parsed.examples) ? parsed.examples : [],
          updatedAt: parsed.updatedAt ?? null,
        };
      } catch {
        return { patterns: [], style: '', examples: [], updatedAt: null };
      }
    }),
});
