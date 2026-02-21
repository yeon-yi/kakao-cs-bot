import { z } from 'zod';
import { router, adminProcedure } from '../trpc';
import { ConfigRepository } from '@kakao-cs-bot/database';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:settings');
const configRepo = new ConfigRepository();

// 민감한 키는 마스킹해서 반환
function maskKey(value: string): string {
  if (!value || value.length < 12) return '****';
  return value.slice(0, 8) + '...' + value.slice(-4);
}

// 설정 가능한 키 정의 (확장 가능)
const SETTING_DEFINITIONS = [
  // 봇 제어
  { key: 'bot.mode', label: '봇 모드', category: 'bot_control', sensitive: false, description: 'off / test / on (기본: off)' },
  { key: 'bot.test_rooms', label: '테스트 방 목록', category: 'bot_control', sensitive: false, description: '테스트 모드에서 봇이 응답할 방 ID (쉼표 구분)' },
  // AI API Keys
  { key: 'api.openai_key', label: 'OpenAI API Key', category: 'api_keys', sensitive: true, description: 'GPT-4o / GPT-4o mini / Embeddings' },
  { key: 'api.gemini_key', label: 'Gemini API Key', category: 'api_keys', sensitive: true, description: 'Google Gemini Flash (백업)' },
  { key: 'api.anthropic_key', label: 'Anthropic API Key', category: 'api_keys', sensitive: true, description: 'Claude (선택)' },
  // AI Settings
  { key: 'ai.default_model', label: 'Default Model', category: 'ai', sensitive: false, description: 'gpt-4o / gpt-4o-mini / gemini-flash' },
  { key: 'ai.gemini.temperature', label: 'Temperature', category: 'ai', sensitive: false, description: '0.0 ~ 2.0 (기본: 0.7)' },
  { key: 'ai.gemini.max_tokens', label: 'Max Tokens', category: 'ai', sensitive: false, description: '최대 출력 토큰 수' },
  { key: 'ai.fallback_enabled', label: 'Fallback 활성화', category: 'ai', sensitive: false, description: '1순위 실패 시 백업 모델 사용' },
  // Knowledge
  { key: 'knowledge.search.similarity_threshold', label: '유사도 임계값', category: 'knowledge', sensitive: false, description: '검색 최소 유사도 (0.0 ~ 1.0)' },
  { key: 'knowledge.search.default_limit', label: '검색 결과 수', category: 'knowledge', sensitive: false, description: '기본 검색 결과 반환 개수' },
  // Response
  { key: 'response.max_length', label: '최대 응답 길이', category: 'response', sensitive: false, description: '봇 응답 최대 글자 수' },
  { key: 'response.escalation_threshold', label: '에스컬레이션 임계값', category: 'response', sensitive: false, description: '이 신뢰도 이하면 사람에게 전달' },
  // AI Chain (멀티모델 체인)
  { key: 'ai.chain_mode', label: '체인 모드', category: 'ai_chain', sensitive: false, description: 'auto / single / 2-chain / 3-chain (기본: auto)' },
  { key: 'ai.chain_analyzer', label: '분석 모델', category: 'ai_chain', sensitive: false, description: 'auto / openai / gemini / anthropic (기본: auto)' },
  { key: 'ai.chain_responder', label: '응답 모델', category: 'ai_chain', sensitive: false, description: 'auto / openai / gemini / anthropic (기본: auto)' },
  { key: 'ai.chain_verifier', label: '검증 모델', category: 'ai_chain', sensitive: false, description: 'auto / openai / gemini / anthropic (기본: auto)' },
  // Webhook / Integration (확장 가능)
  { key: 'webhook.slack_url', label: 'Slack Webhook URL', category: 'integrations', sensitive: true, description: '에스컬레이션 알림용' },
  { key: 'webhook.n8n_url', label: 'n8n Webhook URL', category: 'integrations', sensitive: false, description: 'n8n 워크플로우 연동' },
];

export const settingsRouter = router({
  // 설정 정의 목록 반환
  definitions: adminProcedure
    .query(() => {
      return SETTING_DEFINITIONS.map(d => ({
        key: d.key,
        label: d.label,
        category: d.category,
        sensitive: d.sensitive,
        description: d.description,
      }));
    }),

  // 모든 설정값 조회 (민감한 값은 마스킹)
  getAll: adminProcedure
    .query(async () => {
      const values: Record<string, { value: string; masked: boolean }> = {};

      for (const def of SETTING_DEFINITIONS) {
        const config = await configRepo.get(def.key).catch(() => null);
        if (config) {
          const raw = typeof config.value === 'string' ? config.value : JSON.stringify(config.value);
          values[def.key] = {
            value: def.sensitive ? maskKey(raw.replace(/"/g, '')) : raw.replace(/"/g, ''),
            masked: def.sensitive,
          };
        }
      }

      return values;
    }),

  // 개별 설정 저장
  set: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const def = SETTING_DEFINITIONS.find(d => d.key === input.key);
      if (!def) throw new Error(`Unknown setting: ${input.key}`);

      // 빈 값이면 삭제하지 않고 빈 문자열 저장
      await configRepo.set(input.key, JSON.stringify(input.value), ctx.userId);

      logger.info('Setting updated', {
        key: input.key,
        by: ctx.userId,
        sensitive: def.sensitive,
      });

      return { success: true };
    }),

  // 여러 설정 일괄 저장
  setBulk: adminProcedure
    .input(z.object({
      settings: z.array(z.object({
        key: z.string(),
        value: z.string(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      let saved = 0;
      for (const s of input.settings) {
        const def = SETTING_DEFINITIONS.find(d => d.key === s.key);
        if (!def) continue;
        await configRepo.set(s.key, JSON.stringify(s.value), ctx.userId);
        saved++;
      }

      logger.info('Bulk settings updated', { count: saved, by: ctx.userId });
      return { success: true, saved };
    }),
});
