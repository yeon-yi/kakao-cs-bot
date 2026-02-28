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
  customerProfile?: { interactionCount: number; formalityLevel: string; avgMessageLength: string } | null,
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

  const customerProfileSection = customerProfile
    ? `\n고객 정보:\n- 이 고객과의 대화: ${customerProfile.interactionCount}회째${customerProfile.interactionCount >= 5 ? ' (단골)' : customerProfile.interactionCount <= 1 ? ' (첫 대화)' : ''}\n- 고객 말투: ${customerProfile.formalityLevel === 'casual' ? '편한 말투' : customerProfile.formalityLevel === 'semi-formal' ? '반존댓말' : '격식체'}\n- 메시지 길이 성향: ${customerProfile.avgMessageLength === 'short' ? '짧게 씀 → 답변도 1~2문장으로' : customerProfile.avgMessageLength === 'long' ? '길게 씀 → 충분히 설명' : '보통'}`
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
${learnedToneSection}${customerProfileSection}

반복 금지 (매우 중요):
- 최근 대화의 [주의] 태그를 반드시 확인하고 지시에 따를 것
- 이 대화에서 이미 인사("안녕하세요")를 했으면 절대 다시 인사하지 않고 바로 본론부터 시작
- 이전 응답에서 했던 말과 같은 내용을 반복하지 말 것 (같은 표현, 같은 안내를 다시 하면 안 됨)
- "감사합니다"로 끝내는 마무리를 연속 사용 금지. 이미 감사 표현을 했으면 다른 마무리를 쓰거나 생략
- 참고 지식의 답변을 그대로 복사하지 말고, 현재 대화 맥락에 맞게 변형하여 자연스럽게 녹여낼 것
- 참고 지식의 [정확도] 태그를 확인할 것: "높음"이면 신뢰, "보통"이면 핵심만 활용, "낮음"이면 참고만 하고 불확실하면 "확인 후 안내" 처리
- 고객이 이전 질문과 다른 질문을 했으면 새로운 내용으로 답변할 것

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
- 이모지, 이모티콘, 특수기호 일체 사용 금지
- 물결(~) 사용 금지, 느낌표 남발 금지
- 콤마 뒤에 호칭 붙이지 않기 ("네, 대표님" X → "네 대표님" O)
- "고객님"이라는 호칭 사용 금지. 반드시 "${honorific || '대표님'}"으로만 호칭
- "확인 후 안내드리겠습니다"를 반복하지 않기

응답 예시 (이런 식으로 답변):

좋은 예시:
고객: "네이버 트래픽 광고 CPC가 왜 이렇게 올랐어요?"
→ "네 대표님. 최근 CPC 상승은 보통 입찰 경쟁도 증가나 품질점수 변동이 원인인데요. 현재 캠페인 세팅 캡처 보내주시면 정확히 진단해드리겠습니다."

고객: "담당자 연락이 안 되는데요"
→ "네 대표님. 현재 담당자가 미팅 중인 것 같습니다. 급한 내용이시면 톡방에 남겨주시면 제가 바로 전달드리겠습니다."

나쁜 예시 (절대 하지 않을 것):
- "안녕하세요 대표님. 해당 부분 확인해서 안내드리겠습니다. 감사합니다." (매번 같은 패턴)
- "대표님, 불편을 드려 죄송합니다. 어떤 부분이 문제인지 말씀해 주시면..." (이미 맥락이 있는데 되묻기)
- 이전 응답과 거의 동일한 내용을 다시 보내는 것

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
