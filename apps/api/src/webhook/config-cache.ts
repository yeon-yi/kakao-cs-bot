// ===================== 설정 캐시 및 싱글톤 관리 =====================
import { createLogger, getEnv } from '@kakao-cs-bot/config';
import { ConfigRepository, PromptRepository, query as dbQuery } from '@kakao-cs-bot/database';
import { AIResponseCache, aiGateway } from '@kakao-cs-bot/ai';
import Redis from 'ioredis';
import type { WebhookConfigCache } from './types';

const logger = createLogger('api:webhook:config');
const configRepo = new ConfigRepository();
const promptRepo = new PromptRepository();

// ===================== Redis 싱글톤 =====================
let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(getEnv().REDIS_URL);
    redis.on('error', (err) => logger.warn('Redis connection error', { error: String(err) }));
  }
  return redis;
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => {});
    redis = null;
  }
}

// ===================== 응답 캐시 싱글톤 =====================
let responseCache: AIResponseCache | null = null;

export function getResponseCache(): AIResponseCache {
  if (!responseCache) {
    responseCache = new AIResponseCache();
  }
  return responseCache;
}

export async function disconnectResponseCache(): Promise<void> {
  if (responseCache) {
    await responseCache.disconnect().catch(() => {});
    responseCache = null;
  }
}

// ===================== DB 설정값 파싱 =====================
export function parseConfigValue(config: any, fallback: string = ''): string {
  if (!config?.value) return fallback;
  try {
    const parsed = JSON.parse(config.value);
    return typeof parsed === 'string' ? parsed : String(parsed);
  } catch {
    return String(config.value);
  }
}

// ===================== 통합 설정 캐시 =====================
let webhookConfigCache: WebhookConfigCache | null = null;
const WEBHOOK_CONFIG_CACHE_TTL = 60_000;

export async function getWebhookConfig(): Promise<WebhookConfigCache> {
  const now = Date.now();
  if (webhookConfigCache && now - webhookConfigCache.loadedAt < WEBHOOK_CONFIG_CACHE_TTL) {
    return webhookConfigCache;
  }

  const env = getEnv();
  const [modeConfig, testRoomsConfig, startConfig, endConfig, thresholdConfig] = await Promise.all([
    configRepo.get('bot.mode').catch(() => null),
    configRepo.get('bot.test_rooms').catch(() => null),
    configRepo.get('operation.start_time').catch(() => null),
    configRepo.get('operation.end_time').catch(() => null),
    configRepo.get('response.escalation_threshold').catch(() => null),
  ]);

  const testRoomsStr = parseConfigValue(testRoomsConfig, '').trim();
  const thresholdVal = parseFloat(parseConfigValue(thresholdConfig, '0.5'));

  webhookConfigCache = {
    botMode: parseConfigValue(modeConfig, 'off').trim(),
    testRooms: testRoomsStr ? testRoomsStr.split(',').map((r: string) => r.trim()).filter(Boolean) : [],
    opStart: parseConfigValue(startConfig, env.OPERATION_START_TIME || '09:50'),
    opEnd: parseConfigValue(endConfig, env.OPERATION_END_TIME || '18:30'),
    escalationThreshold: isNaN(thresholdVal) ? 0.5 : thresholdVal,
    loadedAt: now,
  };
  return webhookConfigCache;
}

export function isOperatingHoursFromConfig(config: WebhookConfigCache): boolean {
  const tz = getEnv().OPERATION_TIMEZONE || 'Asia/Seoul';
  const nowStr = new Date().toLocaleString('en-US', { timeZone: tz });
  const kstNow = new Date(nowStr);
  const [startH, startM] = config.opStart.split(':').map(Number);
  const [endH, endM] = config.opEnd.split(':').map(Number);
  const current = kstNow.getHours() * 60 + kstNow.getMinutes();
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  return current >= start && current <= end;
}

// ===================== 직원 카카오이름 캐시 =====================
let staffNameCache: { names: Map<string, number>; loadedAt: number } | null = null;
const STAFF_CACHE_TTL = 300_000;

export async function getStaffNameMap(): Promise<Map<string, number>> {
  const now = Date.now();
  if (staffNameCache && now - staffNameCache.loadedAt < STAFF_CACHE_TTL) {
    return staffNameCache.names;
  }
  const rows = await dbQuery(
    `SELECT cs.id, cs.kakao_name, cs.real_name, sa.alias
     FROM company_staff cs
     LEFT JOIN staff_aliases sa ON sa.staff_id = cs.id AND sa.platform = 'kakao'
     WHERE cs.is_active = true`,
    []
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.kakao_name) map.set(r.kakao_name, r.id);
    if (r.real_name) map.set(r.real_name, r.id);
    if (r.alias) map.set(r.alias, r.id);
  }
  staffNameCache = { names: map, loadedAt: now };
  return map;
}

// ===================== 학습된 톤 프로필 캐시 =====================
let cachedToneProfile: { patterns: string[]; style: string; loadedAt: number } | null = null;
const TONE_PROFILE_CACHE_TTL = 300_000;

export async function getLearnedToneProfile(): Promise<{ patterns: string[]; style: string }> {
  const now = Date.now();
  if (cachedToneProfile && now - cachedToneProfile.loadedAt < TONE_PROFILE_CACHE_TTL) {
    return { patterns: cachedToneProfile.patterns, style: cachedToneProfile.style };
  }
  try {
    const config = await configRepo.get('learned.tone_profile');
    if (config?.value) {
      const parsed = typeof config.value === 'string' ? JSON.parse(config.value) : config.value;
      cachedToneProfile = {
        patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
        style: String(parsed.style ?? ''),
        loadedAt: now,
      };
    } else {
      cachedToneProfile = { patterns: [], style: '', loadedAt: now };
    }
  } catch {
    cachedToneProfile = { patterns: [], style: '', loadedAt: now };
  }
  return { patterns: cachedToneProfile.patterns, style: cachedToneProfile.style };
}

// ===================== 시스템 프롬프트 캐시 =====================
let cachedPrompt: { template: string; loadedAt: number } | null = null;
const PROMPT_CACHE_TTL = 300_000;

export async function getSystemPrompt(
  knowledgeContext: string,
  historyContext: string,
  customerMessage?: string,
  toneMirrorInstructions?: string,
  learnedTone?: { patterns: string[]; style: string },
  honorific?: string,
): Promise<string> {
  const now = Date.now();
  if (!cachedPrompt || now - cachedPrompt.loadedAt > PROMPT_CACHE_TTL) {
    const row = await promptRepo.get('default_answer').catch(() => null);
    cachedPrompt = { template: row?.template ?? '', loadedAt: now };
  }

  if (cachedPrompt?.template) {
    return cachedPrompt.template
      .replace('{{context}}', knowledgeContext)
      .replace('{{history}}', historyContext);
  }

  const learnedToneSection = learnedTone && learnedTone.patterns.length > 0
    ? `\n학습된 응대 스타일:\n- 스타일: ${learnedTone.style || '프로페셔널'}\n- 자주 쓰는 표현: ${learnedTone.patterns.slice(0, 5).join(', ')}`
    : '';

  return `당신은 온라인 마케팅/광고 대행사의 CS 담당 직원입니다.
카카오톡으로 광고주(고객)와 대화합니다. 고객은 대부분 사업주/대표입니다.

대화 스타일:
- 고객을 "${honorific || '대표님'}"으로 호칭
${toneMirrorInstructions || '- 격식체 존댓말 (~습니다 체) 사용'}
- 2~4문장 이내로 간결하고 핵심적으로 답변
- 고객이 불만이면 먼저 공감하고 사과
- 이전 대화 맥락을 자연스럽게 이어가기
- 확신 있는 정보만 전달, 불확실하면 "확인 후 안내드리겠습니다"
- 실무 경험이 풍부한 담당자답게 구체적으로 답변
- 이미 "확인 후 안내" 했으면 같은 말 반복하지 말고 구체적 진행 상황 안내
${learnedToneSection}

범위 외 질문:
- 자사 서비스(네이버트래픽, 블로그기자단, 인스타그램, 홈페이지, SEO, 영상촬영)와 무관한 질문에는 답변하지 마세요
- 구글 애드센스, 유튜브 광고, 페이스북 광고 등 타사 서비스 문의는 정중히 거절
- "해당 내용은 저희 서비스 범위가 아니라 안내가 어렵습니다"로 거절

절대 하지 않을 것:
- AI/챗봇이라는 것을 직간접적으로 드러내기
- "도움이 필요하시면 말씀해주세요" 같은 로봇적 마무리를 매번 붙이기
- "물론입니다", "당연하죠" 같은 과잉 동의 표현
- 매번 같은 패턴의 인사나 마무리 반복
- 불확실한 정보를 확신 있게 전달하기
- 이모지, 이모티콘, 특수기호(📌✅🙏😊👍 등) 일체 사용 금지
- 물결(~) 사용 금지, 느낌표 남발 금지
- 콤마 뒤에 호칭 붙이지 않기 ("네, 대표님" X → "네 대표님" O)
- "확인 후 안내드리겠습니다"를 반복하지 않기

최근 대화:
${historyContext || '(첫 대화)'}

참고 지식:
${knowledgeContext}`;
}

// ===================== 체인 설정 로드 =====================
let chainOverridesLoadedAt = 0;
const CHAIN_OVERRIDES_CACHE_TTL = 300_000;

export async function loadChainOverrides(): Promise<void> {
  const now = Date.now();
  if (now - chainOverridesLoadedAt < CHAIN_OVERRIDES_CACHE_TTL) return;

  try {
    const [modeConfig, analyzerConfig, responderConfig, verifierConfig] = await Promise.all([
      configRepo.get('ai.chain_mode').catch(() => null),
      configRepo.get('ai.chain_analyzer').catch(() => null),
      configRepo.get('ai.chain_responder').catch(() => null),
      configRepo.get('ai.chain_verifier').catch(() => null),
    ]);

    const overrides: { chainMode?: string; analyzer?: string; responder?: string; verifier?: string } = {};
    const mode = parseConfigValue(modeConfig, 'auto');
    if (mode && mode !== 'auto') overrides.chainMode = mode;
    const analyzer = parseConfigValue(analyzerConfig, 'auto');
    if (analyzer && analyzer !== 'auto') overrides.analyzer = analyzer;
    const responder = parseConfigValue(responderConfig, 'auto');
    if (responder && responder !== 'auto') overrides.responder = responder;
    const verifier = parseConfigValue(verifierConfig, 'auto');
    if (verifier && verifier !== 'auto') overrides.verifier = verifier;

    aiGateway.setManualOverrides(overrides);
    chainOverridesLoadedAt = now;
  } catch (e) {
    logger.warn('Failed to load chain overrides', { error: String(e) });
    chainOverridesLoadedAt = now;
  }
}
