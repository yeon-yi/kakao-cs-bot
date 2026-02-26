import { Hono } from 'hono';
import { createLogger, getEnv } from '@kakao-cs-bot/config';
import { KnowledgeRepository, ConversationRepository, EscalationRepository, ProactiveRepository, PromptRepository, ConfigRepository, query as dbQuery, queryOne as dbQueryOne } from '@kakao-cs-bot/database';
import { IdentityRepository } from '@kakao-cs-bot/database';
import { embedder, aiGateway, humanizer } from '@kakao-cs-bot/ai';
import Redis from 'ioredis';

const logger = createLogger('api:webhook');

const knowledgeRepo = new KnowledgeRepository();
const conversationRepo = new ConversationRepository();
const escalationRepo = new EscalationRepository();
const proactiveRepo = new ProactiveRepository();
const promptRepo = new PromptRepository();
const identityRepo = new IdentityRepository();
const configRepo = new ConfigRepository();

// Redis for implicit feedback tracking
let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(getEnv().REDIS_URL);
    redis.on('error', (err) => logger.warn('Redis connection error', { error: String(err) }));
  }
  return redis;
}

// 직원 카카오이름 캐시 (5분 TTL)
let staffNameCache: { names: Map<string, number>; loadedAt: number } | null = null;
const STAFF_CACHE_TTL = 300_000;

async function getStaffNameMap(): Promise<Map<string, number>> {
  const now = Date.now();
  if (staffNameCache && now - staffNameCache.loadedAt < STAFF_CACHE_TTL) {
    return staffNameCache.names;
  }
  const rows = await dbQuery(
    'SELECT id, kakao_name FROM company_staff WHERE is_active = true AND kakao_name IS NOT NULL',
    []
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.kakao_name) map.set(r.kakao_name, r.id);
  }
  staffNameCache = { names: map, loadedAt: now };
  return map;
}

// 방에 있는 직원 찾기 (room_members 테이블)
async function findStaffInRoom(roomId: string): Promise<{ staffId: number; staffName: string } | null> {
  const row = await dbQueryOne(
    `SELECT rm.user_id, rm.user_name, cs.id as staff_id, cs.real_name, cs.department
     FROM room_members rm
     JOIN company_staff cs ON cs.kakao_name = rm.user_name AND cs.is_active = true
     WHERE rm.room_id = $1 AND rm.role = 'company_staff'
     ORDER BY rm.updated_at DESC
     LIMIT 1`,
    [roomId]
  );
  if (row) {
    return { staffId: row.staff_id, staffName: row.real_name };
  }
  return null;
}

// DB 설정값 파싱 헬퍼 (JSON.stringify된 값 안전하게 추출)
function parseConfigValue(config: any, fallback: string = ''): string {
  if (!config?.value) return fallback;
  try {
    const parsed = JSON.parse(config.value);
    return typeof parsed === 'string' ? parsed : String(parsed);
  } catch {
    return String(config.value);
  }
}

// ===================== 운영시간 체크 (DB 우선, env 폴백, 5분 캐시) =====================
let cachedOpHours: { start: string; end: string; loadedAt: number } | null = null;
const OP_HOURS_CACHE_TTL = 300_000;

async function isOperatingHoursFromDB(): Promise<boolean> {
  const now = Date.now();
  if (!cachedOpHours || now - cachedOpHours.loadedAt >= OP_HOURS_CACHE_TTL) {
    const env = getEnv();
    const [startConfig, endConfig] = await Promise.all([
      configRepo.get('operation.start_time').catch(() => null),
      configRepo.get('operation.end_time').catch(() => null),
    ]);
    cachedOpHours = {
      start: parseConfigValue(startConfig, env.OPERATION_START_TIME || '09:50'),
      end: parseConfigValue(endConfig, env.OPERATION_END_TIME || '18:30'),
      loadedAt: now,
    };
  }

  const tz = getEnv().OPERATION_TIMEZONE || 'Asia/Seoul';
  const nowStr = new Date().toLocaleString('en-US', { timeZone: tz });
  const kstNow = new Date(nowStr);
  const [startH, startM] = cachedOpHours.start.split(':').map(Number);
  const [endH, endM] = cachedOpHours.end.split(':').map(Number);
  const current = kstNow.getHours() * 60 + kstNow.getMinutes();
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  return current >= start && current <= end;
}

// ===================== 에스컬레이션 임계값 (DB 연동, 5분 캐시) =====================
let cachedThreshold: { value: number; loadedAt: number } | null = null;
const THRESHOLD_CACHE_TTL = 300_000;

async function getEscalationThreshold(): Promise<number> {
  const now = Date.now();
  if (cachedThreshold && now - cachedThreshold.loadedAt < THRESHOLD_CACHE_TTL) {
    return cachedThreshold.value;
  }
  try {
    const config = await configRepo.get('response.escalation_threshold');
    const val = parseFloat(parseConfigValue(config, '0.5'));
    cachedThreshold = { value: isNaN(val) ? 0.5 : val, loadedAt: now };
  } catch {
    cachedThreshold = { value: 0.5, loadedAt: now };
  }
  return cachedThreshold.value;
}

// ===================== 톤 미러링: 고객 말투 감지 =====================
interface CustomerToneProfile {
  formalityLevel: 'formal' | 'semi-formal' | 'casual';
  usesEmoji: boolean;
  messageLength: 'short' | 'medium' | 'long';
  honorific: string;
}

function detectCustomerTone(message: string, historyContext: string): CustomerToneProfile {
  const allText = `${message} ${historyContext}`;

  // 격식 수준 감지
  let formalityLevel: CustomerToneProfile['formalityLevel'] = 'formal';
  const casualPatterns = /ㅋㅋ|ㅎㅎ|ㅇㅇ|ㅇㅋ|ㄱㅅ|ㄴㄴ|반말|해줘|해봐|알려줘[^요]|뭐야|왜[?？]|그래\?/;
  const semiFormalPatterns = /~요|해요|인가요|인데요|할게요|줄게요|어떤가요|괜찮나요/;

  if (casualPatterns.test(allText)) {
    formalityLevel = 'casual';
  } else if (semiFormalPatterns.test(allText)) {
    formalityLevel = 'semi-formal';
  }

  // 이모지/이모티콘 사용 감지
  const usesEmoji = /[😀-😿🙀-🙏🤗-🤹👍-👻💀-💿🎀-🏿🐀-🔿🕐-🗿😊🥰🤔💪🔥❤️✨⭐️🎉👏💕🥺😂😅😍🙏💯🎵☺️]/u.test(allText)
    || /\^\^|ㅋㅋ|ㅎㅎ|:\)|:D|XD/.test(allText);

  // 메시지 길이 경향
  const avgLen = message.length;
  const messageLength = avgLen < 30 ? 'short' : avgLen < 100 ? 'medium' : 'long';

  // 호칭 감지 (고객이 사용하는 호칭)
  let honorific = '대표님';
  if (/담당자님/.test(allText)) honorific = '담당자님';
  else if (/선생님/.test(allText)) honorific = '선생님';

  return { formalityLevel, usesEmoji, messageLength, honorific };
}

function buildToneMirrorInstructions(tone: CustomerToneProfile): string {
  const lines: string[] = [];

  switch (tone.formalityLevel) {
    case 'casual':
      lines.push('- 고객이 캐주얼한 말투를 사용하므로 살짝 부드러운 존댓말 (~요 체) 사용 가능');
      lines.push('- 너무 딱딱하지 않게, 친근하면서도 프로페셔널하게');
      break;
    case 'semi-formal':
      lines.push('- 고객이 반존댓말을 사용하므로 자연스러운 존댓말 (~요 체 위주) 사용');
      break;
    default:
      lines.push('- 격식체 존댓말 (~습니다 체) 사용');
      break;
  }

  if (tone.usesEmoji) {
    lines.push('- 고객이 이모지를 사용하므로, 적절한 곳에 이모지 1~2개 가볍게 활용 가능');
  } else {
    lines.push('- 이모지 사용 자제');
  }

  if (tone.messageLength === 'short') {
    lines.push('- 고객이 짧은 메시지를 선호하므로 1~2문장으로 간결하게 답변');
  } else if (tone.messageLength === 'long') {
    lines.push('- 고객이 상세한 질문을 하므로 충분히 설명하되 3~5문장 이내');
  }

  return lines.join('\n');
}

// ===================== 학습된 톤 프로필 로드 (DB 캐시) =====================
let cachedToneProfile: { patterns: string[]; style: string; loadedAt: number } | null = null;
const TONE_PROFILE_CACHE_TTL = 300_000;

async function getLearnedToneProfile(): Promise<{ patterns: string[]; style: string }> {
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

// ===================== 프롬프트 (대화 히스토리 + 톤 미러링 지원) =====================
let cachedPrompt: { template: string; loadedAt: number } | null = null;
const PROMPT_CACHE_TTL = 300000;

async function getSystemPrompt(knowledgeContext: string, historyContext: string, customerMessage?: string): Promise<string> {
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

  // 톤 미러링 + 학습된 톤 프로필 적용
  const customerTone = detectCustomerTone(customerMessage || '', historyContext);
  const toneMirrorInstructions = buildToneMirrorInstructions(customerTone);

  const learnedTone = await getLearnedToneProfile();
  const learnedToneSection = learnedTone.patterns.length > 0
    ? `\n학습된 응대 스타일:\n- 스타일: ${learnedTone.style || '프로페셔널'}\n- 자주 쓰는 표현: ${learnedTone.patterns.slice(0, 5).join(', ')}`
    : '';

  return `당신은 온라인 마케팅/광고 대행사의 CS 담당 직원입니다.
카카오톡으로 광고주(고객)와 대화합니다. 고객은 대부분 사업주/대표입니다.

대화 스타일:
- 고객을 "${customerTone.honorific}"으로 호칭
${toneMirrorInstructions}
- 2~4문장 이내로 간결하고 핵심적으로 답변
- 고객이 불만이면 먼저 공감하고 사과
- 이전 대화 맥락을 자연스럽게 이어가기
- 확신 있는 정보만 전달, 불확실하면 "확인 후 안내드리겠습니다"
- 실무 경험이 풍부한 담당자답게 구체적으로 답변
${learnedToneSection}

절대 하지 않을 것:
- AI/챗봇이라는 것을 직간접적으로 드러내기
- "도움이 필요하시면 말씀해주세요" 같은 로봇적 마무리를 매번 붙이기
- "물론입니다", "당연하죠" 같은 과잉 동의 표현
- 매번 같은 패턴의 인사나 마무리 반복
- 불확실한 정보를 확신 있게 전달하기

최근 대화:
${historyContext || '(첫 대화)'}

참고 지식:
${knowledgeContext}`;
}

// ===================== 대화 히스토리 포맷팅 (확장된 컨텍스트) =====================
async function getConversationHistory(roomId: string, userName: string): Promise<string> {
  try {
    const history = await conversationRepo.getHistory(roomId, userName, 12);
    if (!history || history.length === 0) return '';

    // 최신→오래된 순으로 반환되므로 reverse
    const ordered = history.reverse();

    // 최근 5개는 전문, 나머지는 요약 (컨텍스트 길이 최적화)
    const recentCount = Math.min(5, ordered.length);
    const olderItems = ordered.slice(0, ordered.length - recentCount);
    const recentItems = ordered.slice(ordered.length - recentCount);

    const parts: string[] = [];

    // 오래된 대화 요약
    if (olderItems.length > 0) {
      const summary = olderItems.map((h: any) => {
        const q = h.user_message ? h.user_message.substring(0, 50) : '';
        const a = h.bot_response ? h.bot_response.substring(0, 50) : '';
        return `고객:"${q}${h.user_message?.length > 50 ? '...' : ''}" → 답변:"${a}${h.bot_response?.length > 50 ? '...' : ''}"`;
      }).join(' | ');
      parts.push(`[이전 대화 요약] ${summary}`);
    }

    // 최근 대화 전문
    for (const h of recentItems) {
      const lines: string[] = [];
      if (h.user_message) lines.push(`[고객] ${h.user_message}`);
      if (h.bot_response) lines.push(`[나] ${h.bot_response}`);
      if (lines.length > 0) parts.push(lines.join('\n'));
    }

    return parts.join('\n\n');
  } catch {
    return '';
  }
}

// ===================== 암시적 피드백 감지 =====================
// 비꼬기/냉소 패턴 (감사+불만 동시)
const SARCASM_PATTERNS = /고맙네|감사하네|덕분에.*떨어|덕분에.*줄|잘\s*하시네|대단하시|:\)/i;
const COMPLAINT_WITH_THANKS = /떨어|줄었|손해|피해|매출|지켜볼|두고\s*보|가만/i;

const PURE_POSITIVE_PATTERNS = /감사합니다|고맙습니다|ㄱㅅ|알겠습니다|넵|네\s*알겠|오[키케]|ㅇㅋ|좋아요|완벽|최고/i;
const NEGATIVE_PATTERNS = /아니[요요]?(?:\s|$)|다시\s*(?:한번|알려|설명)|제대로|뭔소리|이해가\s*안|틀렸|잘못|엉뚱한/i;

async function checkImplicitFeedback(roomId: string, userName: string, currentMessage: string, currentEmbedding: number[]): Promise<void> {
  try {
    const redisClient = getRedis();
    const prevKey = `lastconv:${roomId}:${userName}`;
    const prevData = await redisClient.get(prevKey);

    if (!prevData) return;

    const prev = JSON.parse(prevData);
    const prevConvId = prev.conversationId;
    const prevKnowledgeId = prev.knowledgeId;

    // 비꼬기 감지: 감사 표현 + 불만 키워드 동시 존재 → 부정적
    const isSarcastic = SARCASM_PATTERNS.test(currentMessage)
      || (/(감사|고맙)/.test(currentMessage) && COMPLAINT_WITH_THANKS.test(currentMessage));

    let feedbackRecorded = false;

    if (isSarcastic) {
      await conversationRepo.markHelpful(prevConvId, false);
      if (prevKnowledgeId) {
        await knowledgeRepo.adjustConfidence(prevKnowledgeId, -0.1).catch(() => {});
      }
      feedbackRecorded = true;
      logger.debug('Sarcastic negative feedback detected', { roomId, convId: prevConvId });
    } else if (PURE_POSITIVE_PATTERNS.test(currentMessage) && !COMPLAINT_WITH_THANKS.test(currentMessage)) {
      await conversationRepo.markHelpful(prevConvId, true);
      if (prevKnowledgeId) {
        await knowledgeRepo.adjustConfidence(prevKnowledgeId, 0.05).catch(() => {});
      }
      feedbackRecorded = true;
      logger.debug('Implicit positive feedback', { roomId, convId: prevConvId });
    } else if (NEGATIVE_PATTERNS.test(currentMessage)) {
      await conversationRepo.markHelpful(prevConvId, false);
      if (prevKnowledgeId) {
        await knowledgeRepo.adjustConfidence(prevKnowledgeId, -0.1).catch(() => {});
      }
      feedbackRecorded = true;
      logger.debug('Implicit negative feedback', { roomId, convId: prevConvId });
    }

    // 같은 질문 반복 감지 (similarity > 0.85) - 텍스트 피드백 미감지 시에만
    if (!feedbackRecorded && prev.embedding && currentEmbedding) {
      const truncLen = Math.min(currentEmbedding.length, prev.embedding.length);
      const similarity = cosineSimilarity(currentEmbedding.slice(0, truncLen), prev.embedding.slice(0, truncLen));
      if (similarity > 0.85) {
        await conversationRepo.markHelpful(prevConvId, false);
        if (prevKnowledgeId) {
          await knowledgeRepo.adjustConfidence(prevKnowledgeId, -0.15).catch(() => {});
        }
        feedbackRecorded = true;
        logger.debug('Repeated question detected', { roomId, similarity });
      }
    }

    // 피드백이 기록된 경우에만 키 삭제 (미기록 시 다음 메시지에서 재시도)
    if (feedbackRecorded) {
      await redisClient.del(prevKey);
    }
  } catch (e) {
    logger.warn('Implicit feedback check failed', { error: String(e) });
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// ===================== 에스컬레이션 메시지 다양화 =====================
const ESCALATION_TEMPLATES = [
  '확인해보고 바로 안내드릴게요! 잠시만 기다려주세요~',
  '아 그 부분은 제가 좀 더 확인해볼게요. 금방 답변드리겠습니다!',
  '잠깐만요, 정확한 내용 확인해서 바로 안내드릴게요!',
  '네 해당 부분 확인 후 안내드리겠습니다. 조금만 기다려주세요!',
  '좋은 질문이세요! 정확하게 확인해서 말씀드릴게요~',
  '아 그 부분이시군요. 확인해보고 바로 알려드리겠습니다!',
];

function getEscalationMessage(): string {
  return ESCALATION_TEMPLATES[Math.floor(Math.random() * ESCALATION_TEMPLATES.length)];
}

const VALID_CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

// 메시지 배칭: 여러 줄로 나눠 보내는 메시지를 종합 처리
const MESSAGE_BUFFER_MS = 3000; // 3초 디바운스

export const webhookApp = new Hono();

// API Key 검증 미들웨어
webhookApp.use('*', async (c, next) => {
  const apiKey = c.req.header('X-API-Key') || c.req.query('key');
  const secret = getEnv().WEBHOOK_SECRET;

  if (!secret || apiKey !== secret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
});

// 메시지 처리 엔드포인트
webhookApp.post('/message', async (c) => {
  const startTime = Date.now();

  try {
    const body = await c.req.json();
    const { roomId, userName, message, isGroupChat, messageType, imageUrl } = body;
    const effectiveMessageType: string = messageType || 'text';

    if (!roomId || !message) {
      return c.json({ error: 'roomId and message are required' }, 400);
    }

    // 0-1. 발신자 직원 여부 자동 감지 → room_members 기록
    if (userName) {
      try {
        const staffMap = await getStaffNameMap();
        const staffId = staffMap.get(userName);
        if (staffId) {
          await identityRepo.upsertRoomMember(roomId, userName, userName, 'company_staff', 1.0);
          return c.json({ answer: null, reason: 'staff_message' });
        } else {
          await identityRepo.upsertRoomMember(roomId, userName, userName, 'advertiser', 0.5);
        }
      } catch (e) {
        logger.warn('Staff detection failed', { error: String(e) });
      }
    }

    // 0-2. 차단된 방 체크
    const isBlocked = await proactiveRepo.isBlocked(roomId).catch(() => false);
    if (isBlocked) {
      return c.json({ answer: null, reason: 'room_blocked' });
    }

    // 0-3. 봇 모드 체크 (off / test / on)
    const botModeConfig = await configRepo.get('bot.mode').catch(() => null);
    const botMode = parseConfigValue(botModeConfig, 'off').trim();

    if (botMode === 'off') {
      return c.json({ answer: null, reason: 'bot_disabled' });
    }

    let isTestMode = false;
    if (botMode === 'test') {
      // 테스트 모드: 등록된 방에서만 응답 (운영시간 무시 - 24시간 테스트 가능)
      const testRoomsConfig = await configRepo.get('bot.test_rooms').catch(() => null);
      const testRoomsStr = parseConfigValue(testRoomsConfig, '').trim();
      const testRooms = testRoomsStr ? testRoomsStr.split(',').map((r: string) => r.trim()).filter(Boolean) : [];

      if (testRooms.length === 0 || !testRooms.includes(roomId)) {
        return c.json({ answer: null, reason: 'test_mode_excluded' });
      }
      isTestMode = true;
      // 테스트 방이면 통과 → 운영시간 무시하고 정상 응답
    }
    // botMode === 'on' → 전체 통과 (운영시간 체크 필요)

    // 0-4. 사진/미디어 메시지 처리
    if (effectiveMessageType !== 'text') {
      return await handleNonTextMessage(c, {
        roomId, userName: userName || 'unknown', message,
        isGroupChat, messageType: effectiveMessageType, imageUrl,
        startTime,
      });
    }

    // 1. 운영 시간 체크 (테스트 모드에서는 건너뜀 - 24시간 학습/테스트 가능)
    if (!isTestMode && !(await isOperatingHoursFromDB())) {
      return c.json({ answer: null, reason: 'outside_hours' });
    }

    // 2. 메시지 배칭 (여러 줄 메시지 종합 처리)
    const redisClient = getRedis();
    const bufferKey = `msgbuf:${roomId}`;
    const nonceKey = `msgnonce:${roomId}`;

    await redisClient.rpush(bufferKey, message);
    await redisClient.expire(bufferKey, 30);

    const myNonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await redisClient.set(nonceKey, myNonce, 'EX', 30);

    // 디바운스 대기
    await new Promise(resolve => setTimeout(resolve, MESSAGE_BUFFER_MS));

    // 내가 마지막 메시지인지 확인
    const latestNonce = await redisClient.get(nonceKey);
    if (latestNonce !== myNonce) {
      return c.json({ answer: null, reason: 'buffering' });
    }

    // 버퍼의 모든 메시지 수집
    const bufferedMessages = await redisClient.lrange(bufferKey, 0, -1);
    await redisClient.del(bufferKey);
    await redisClient.del(nonceKey);

    const combinedMessage = bufferedMessages.length > 1
      ? bufferedMessages.join('\n')
      : message;

    if (bufferedMessages.length > 1) {
      logger.info('Messages batched', { roomId, count: bufferedMessages.length });
    }

    // 3. 임베딩 + 지식베이스 검색
    const embedding = await embedder.embed(combinedMessage);
    const knowledge = await knowledgeRepo.search(embedding, combinedMessage, { limit: 5 });

    // 3-1. 암시적 피드백 체크 (이전 대화에 대한 반응)
    await checkImplicitFeedback(roomId, userName || 'unknown', combinedMessage, embedding);

    const topSimilarity = knowledge.length > 0 ? (knowledge[0].similarity ?? 0) : 0;
    const threshold = await getEscalationThreshold();
    const needsEscalation = knowledge.length === 0 || topSimilarity < threshold;

    let answer: string;
    let escalated = false;
    let category: string | null = null;
    let aiModel: string | null = null;
    let knowledgeTier: number | null = null;
    let conversationId: number | null = null;
    let usedKnowledgeId: string | null = null;

    // 대화 히스토리 가져오기
    const historyContext = await getConversationHistory(roomId, userName || 'unknown');

    if (needsEscalation) {
      // 4a. 에스컬레이션
      answer = humanizer.humanizeResponse(getEscalationMessage(), { isThankYou: false });
      escalated = true;

      category = await classifyCategory(combinedMessage);

      const conversation = await conversationRepo.create({
        room_id: roomId,
        user_id: userName || 'unknown',
        user_name: userName,
        user_message: combinedMessage,
        bot_response: answer,
        context: { isGroupChat },
        knowledge_tier: null,
        ai_model: null,
        confidence: topSimilarity,
        response_time_ms: Date.now() - startTime,
      });
      conversationId = conversation?.id;

      // 에스컬레이션 담당자 배정 (톡방별 담당자 우선)
      let assignedStaffId: number | null = null;
      let assignedSource = '';

      const roomStaff = await findStaffInRoom(roomId).catch(() => null);
      if (roomStaff) {
        assignedStaffId = roomStaff.staffId;
        assignedSource = `room_staff:${roomStaff.staffName}`;
      }

      if (!assignedStaffId) {
        const categoryAssignee = await escalationRepo.getAssigneeByCategory(category, roomId).catch(() => null);
        if (categoryAssignee) {
          assignedStaffId = (categoryAssignee as any).staff_id;
          assignedSource = `category:${category}`;
        }
      }

      await escalationRepo.create({
        conversation_id: conversation?.id,
        room_id: roomId,
        user_id: userName || 'unknown',
        user_name: userName,
        user_message: combinedMessage,
        bot_response: answer,
        category,
        confidence: topSimilarity,
        status: assignedStaffId ? 'assigned' : 'pending',
        assigned_to: assignedStaffId,
        assigned_at: assignedStaffId ? new Date().toISOString() : null,
      });

      // 불확실 주제 기록
      await recordUncertainty(combinedMessage, category || '일반', topSimilarity).catch(() => {});

      logger.info('Escalation created', { roomId, userName, category, similarity: topSimilarity, threshold, assignedTo: assignedSource || 'none' });
    } else {
      // 4b. 정상 응답 (멀티모델 체인 지원)
      const knowledgeContext = knowledge
        .map(k => `Q: ${k.question}\nA: ${k.answer}`)
        .join('\n\n');

      // 체인 전략 확인 → 수동 설정 로드
      await loadChainOverrides();

      const strategy = aiGateway.resolveChainStrategy();
      let responseText: string;
      let chainStepsJson: any = null;

      if (strategy.mode !== 'single') {
        // 멀티모델 체인 실행
        const chainResult = await aiGateway.generateChain(
          combinedMessage, knowledgeContext, historyContext
        );
        responseText = chainResult.finalText;
        aiModel = chainResult.steps.map(s => s.model).join(' → ');
        chainStepsJson = chainResult.steps.map(s => ({
          role: s.role, model: s.model, provider: s.provider,
          tokens: s.tokensUsed, cost: s.cost, latencyMs: s.latencyMs,
        }));
        logger.info('Chain response', {
          roomId, mode: chainResult.mode, models: aiModel,
          totalCost: chainResult.totalCost, latencyMs: chainResult.totalLatencyMs,
        });
      } else {
        // 단일 모델 (기존 동작)
        const systemPrompt = await getSystemPrompt(knowledgeContext, historyContext, combinedMessage);
        const response = await aiGateway.generate({
          prompt: combinedMessage,
          systemPrompt,
          temperature: 0.3,
        });
        responseText = response.text;
        aiModel = response.model;
        // 단일 모델도 비용 정보 기록
        chainStepsJson = [{
          role: 'responder',
          model: response.model,
          provider: response.model.startsWith('gpt') ? 'openai'
            : response.model.startsWith('gemini') ? 'gemini'
            : response.model.startsWith('claude') ? 'anthropic' : 'unknown',
          tokens: response.tokensUsed,
          cost: response.cost,
          latencyMs: response.latencyMs,
        }];
      }

      knowledgeTier = knowledge[0]?.tier ?? null;
      usedKnowledgeId = knowledge[0]?.id ?? null;

      // 인간화 (톤 분석 + 톤 미러링 포함)
      const isThankYou = /감사|고마|ㄱㅅ/.test(combinedMessage);
      const customerToneForHumanizer = detectCustomerTone(combinedMessage, historyContext);
      answer = humanizer.humanizeResponse(responseText, {
        isThankYou,
        customerMessage: combinedMessage,
        hasHistory: historyContext.length > 0,
        customerFormality: customerToneForHumanizer.formalityLevel,
      });

      if (knowledge[0]?.id) {
        await knowledgeRepo.incrementUsage(knowledge[0].id).catch(() => {});
      }

      const conversation = await conversationRepo.create({
        room_id: roomId,
        user_id: userName || 'unknown',
        user_name: userName,
        user_message: combinedMessage,
        bot_response: answer,
        context: { isGroupChat },
        knowledge_tier: knowledgeTier,
        ai_model: aiModel,
        confidence: topSimilarity,
        response_time_ms: Date.now() - startTime,
        chain_steps: chainStepsJson ? JSON.stringify(chainStepsJson) : null,
      });
      conversationId = conversation?.id;

      // hedging 감지 → 불확실 주제 기록
      if (/정확하지 않을 수|확인이 필요|아마|추후 확인/.test(answer)) {
        await recordUncertainty(combinedMessage, knowledge[0]?.category || '일반', topSimilarity, 'hedging').catch(() => {});
      }

      logger.info('Response generated', {
        roomId, userName, model: aiModel,
        similarity: topSimilarity, tier: knowledgeTier,
        chainMode: strategy.mode,
        latencyMs: Date.now() - startTime,
      });
    }

    // 5. 암시적 피드백을 위해 현재 대화 정보 Redis에 저장 (TTL 10분)
    if (conversationId && !escalated) {
      try {
        await getRedis().setex(
          `lastconv:${roomId}:${userName || 'unknown'}`,
          600,
          JSON.stringify({
            conversationId,
            knowledgeId: usedKnowledgeId,
            embedding: embedding.slice(0, 100), // 메모리 절약: 처음 100차원만 저장
          })
        );
      } catch {}
    }

    // 6. 인간다운 딜레이 계산 + 메시지 분할
    const delay = humanizer.getResponseDelay();
    const messages = humanizer.splitIntoMessages(answer);

    return c.json({
      answer: messages[0]?.text || answer,
      delay,
      // 분할된 후속 메시지가 있으면 포함
      followUp: messages.length > 1 ? messages.slice(1) : undefined,
      escalated,
      category,
      confidence: topSimilarity,
      processingMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('Webhook error', { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ===================== 불확실 주제 기록 =====================
async function recordUncertainty(
  question: string, category: string, similarity: number,
  source?: string
): Promise<void> {
  const detectedSource = source || (similarity < 0.3 ? 'new_topic' : 'low_similarity');

  // 같은 카테고리의 비슷한 불확실 주제가 이미 있는지 확인
  const existing = await dbQueryOne(
    `SELECT id, occurrence_count, avg_similarity FROM uncertainty_topics
     WHERE category = $1 AND status = 'open'
     AND similarity(topic, $2) > 0.5
     LIMIT 1`,
    [category, question]
  ).catch(() => null);

  if (existing) {
    await dbQuery(
      `UPDATE uncertainty_topics
       SET occurrence_count = occurrence_count + 1,
           avg_similarity = ($1 + avg_similarity * occurrence_count) / (occurrence_count + 1),
           last_seen_at = NOW(),
           sample_question = CASE WHEN LENGTH($2) > LENGTH(sample_question) THEN $2 ELSE sample_question END
       WHERE id = $3`,
      [similarity, question, existing.id]
    ).catch(() => {});
  } else {
    await dbQuery(
      `INSERT INTO uncertainty_topics (topic, category, sample_question, source, avg_similarity)
       VALUES ($1, $2, $3, $4, $5)`,
      [question.substring(0, 200), category, question, detectedSource, similarity]
    ).catch(() => {});
  }
}

// 상태 확인 엔드포인트
webhookApp.get('/status', async (c) => {
  return c.json({
    status: 'ok',
    operatingHours: humanizer.isOperatingHours(),
    timestamp: new Date().toISOString(),
  });
});

// ===================== 기기 모니터링 엔드포인트 =====================

// 기기 등록/업데이트
webhookApp.post('/device/register', async (c) => {
  try {
    const body = await c.req.json();
    const { deviceId, deviceName, deviceType, appVersion, osVersion } = body;
    if (!deviceId) return c.json({ error: 'deviceId required' }, 400);

    await dbQuery(
      `INSERT INTO connected_devices (device_id, device_name, device_type, app_version, os_version, status, last_heartbeat)
       VALUES ($1, $2, $3, $4, $5, 'online', NOW())
       ON CONFLICT (device_id) DO UPDATE SET
         device_name = COALESCE($2, connected_devices.device_name),
         device_type = COALESCE($3, connected_devices.device_type),
         app_version = COALESCE($4, connected_devices.app_version),
         os_version = COALESCE($5, connected_devices.os_version),
         status = 'online',
         last_heartbeat = NOW()`,
      [deviceId, deviceName || null, deviceType || 'android', appVersion || null, osVersion || null]
    );
    logger.info('Device registered', { deviceId, deviceName });
    return c.json({ success: true });
  } catch (error) {
    logger.error('Device register error', { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// 하트비트
webhookApp.post('/device/heartbeat', async (c) => {
  try {
    const body = await c.req.json();
    const { deviceId, messagesTotal, messagesToday, error: deviceError } = body;
    if (!deviceId) return c.json({ error: 'deviceId required' }, 400);

    if (deviceError) {
      await dbQuery(
        `UPDATE connected_devices SET
           status = 'error', last_heartbeat = NOW(),
           last_error = $2, error_count = error_count + 1
         WHERE device_id = $1`,
        [deviceId, deviceError]
      );
    } else {
      await dbQuery(
        `UPDATE connected_devices SET
           status = 'online', last_heartbeat = NOW(),
           messages_sent = COALESCE($2, messages_sent),
           messages_today = COALESCE($3, messages_today),
           last_error = NULL
         WHERE device_id = $1`,
        [deviceId, messagesTotal ?? null, messagesToday ?? null]
      );
    }
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ===================== 프로액티브 메시징 엔드포인트 (봇 앱용) =====================

webhookApp.get('/proactive/pending', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '5');
    const messages = await proactiveRepo.getPendingMessages(limit);
    return c.json({ messages });
  } catch (error) {
    logger.error('Proactive pending error', { error: String(error) });
    return c.json({ messages: [], error: 'Failed to fetch pending messages' });
  }
});

webhookApp.post('/proactive/report', async (c) => {
  try {
    const body = await c.req.json();
    const { id, status, error: errorMsg } = body;

    if (!id || !status) {
      return c.json({ error: 'id and status are required' }, 400);
    }

    if (status === 'sent') {
      await proactiveRepo.markSent(id);
    } else if (status === 'failed') {
      await proactiveRepo.markFailed(id, errorMsg || 'unknown');
    }

    return c.json({ success: true });
  } catch (error) {
    logger.error('Proactive report error', { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ===================== n8n 자동화 엔드포인트 =====================

webhookApp.post('/proactive/generate', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const inactiveDays = body.inactiveDays || 5;

    const inactiveRooms = await proactiveRepo.findInactiveRooms(inactiveDays);

    if (inactiveRooms.length === 0) {
      return c.json({ created: 0, rooms: [], message: '비활성 방 없음' });
    }

    const GREETING_TEMPLATES = [
      '안녕하세요! 혹시 추가로 도움이 필요하신 부분 있으신가요?',
      '안녕하세요! 잘 지내고 계시죠? 문의사항이 있으시면 편하게 말씀해주세요.',
      '안녕하세요! 그동안 잘 진행되고 계신가요? 필요하신 부분 있으시면 언제든 알려주세요.',
    ];

    const created: string[] = [];

    for (const room of inactiveRooms) {
      try {
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

    logger.info('n8n: Greetings generated', { count: created.length, inactiveDays });
    return c.json({ created: created.length, rooms: created });
  } catch (error) {
    logger.error('Proactive generate error', { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

webhookApp.get('/blocks/check', async (c) => {
  try {
    const roomId = c.req.query('roomId');
    if (!roomId) return c.json({ error: 'roomId required' }, 400);
    const blocked = await proactiveRepo.isBlocked(roomId);
    return c.json({ blocked });
  } catch (error) {
    return c.json({ blocked: false });
  }
});

// ===================== 사진/미디어 메시지 처리 =====================
const PHOTO_RESPONSE_TEMPLATES = [
  '네 대표님, 사진 확인했습니다! 확인 후 안내드리겠습니다.',
  '사진 잘 받았습니다. 확인해보고 바로 말씀드릴게요!',
  '네, 사진 확인했어요! 내용 검토 후 연락드리겠습니다.',
  '사진 전달 감사합니다! 확인해보고 안내드릴게요~',
  '네 대표님, 사진 잘 받았습니다. 확인 후 답변드리겠습니다!',
];

const VIDEO_RESPONSE_TEMPLATES = [
  '네 대표님, 영상 확인했습니다! 검토 후 안내드리겠습니다.',
  '영상 잘 받았습니다. 확인해보고 말씀드릴게요!',
  '네, 영상 확인했어요! 내용 검토 후 연락드리겠습니다.',
];

interface NonTextMessageParams {
  roomId: string;
  userName: string;
  message: string;
  isGroupChat?: boolean;
  messageType: string;
  imageUrl?: string;
  startTime: number;
}

async function handleNonTextMessage(c: any, params: NonTextMessageParams) {
  const { roomId, userName, message, isGroupChat, messageType, imageUrl, startTime } = params;

  // 미디어 유형별 응답 템플릿 선택
  const templates = messageType === 'video' ? VIDEO_RESPONSE_TEMPLATES : PHOTO_RESPONSE_TEMPLATES;
  const templateResponse = templates[Math.floor(Math.random() * templates.length)];
  const answer = humanizer.humanizeResponse(templateResponse, { isThankYou: false });

  // 최근 대화 맥락으로 카테고리 분류
  let category: string | null = null;
  try {
    const history = await conversationRepo.getHistory(roomId, userName, 3);
    if (history && history.length > 0) {
      const recentMessages = history.map((h: any) => h.user_message).filter(Boolean).join(' ');
      category = await classifyCategory(recentMessages);
    } else {
      category = '일반';
    }
  } catch {
    category = '일반';
  }

  // 대화 기록 저장 (message_type 포함)
  const conversation = await conversationRepo.create({
    room_id: roomId,
    user_id: userName,
    user_name: userName,
    user_message: `[${messageType === 'video' ? '영상' : '사진'}] ${message}`,
    bot_response: answer,
    context: { isGroupChat, imageUrl: imageUrl || null },
    knowledge_tier: null,
    ai_model: null,
    confidence: null,
    response_time_ms: Date.now() - startTime,
    message_type: messageType,
  });

  // 에스컬레이션 생성 (사진/영상 전용)
  let assignedStaffId: number | null = null;

  // 1) 톡방 소속 직원 우선
  const roomStaff = await findStaffInRoom(roomId).catch(() => null);
  if (roomStaff) {
    assignedStaffId = roomStaff.staffId;
  }

  // 2) 카테고리 담당자
  if (!assignedStaffId && category) {
    const categoryAssignee = await escalationRepo.getAssigneeByCategory(category, roomId).catch(() => null);
    if (categoryAssignee) {
      assignedStaffId = (categoryAssignee as any).staff_id;
    }
  }

  // 최근 대화 맥락 500자 첨부
  let contextSummary = '';
  try {
    const historyText = await getConversationHistory(roomId, userName);
    if (historyText) {
      contextSummary = historyText.substring(0, 500);
    }
  } catch {}

  await escalationRepo.create({
    conversation_id: conversation?.id,
    room_id: roomId,
    user_id: userName,
    user_name: userName,
    user_message: `[${messageType === 'video' ? '영상' : '사진'}] ${message}${contextSummary ? '\n\n--- 최근 대화 ---\n' + contextSummary : ''}`,
    bot_response: answer,
    category,
    confidence: null,
    status: assignedStaffId ? 'assigned' : 'pending',
    assigned_to: assignedStaffId,
    escalation_type: messageType === 'video' ? 'video' : 'photo',
  });

  logger.info('Non-text message escalated', {
    roomId, userName, messageType, category,
    assignedTo: assignedStaffId || 'none',
    latencyMs: Date.now() - startTime,
  });

  const delay = humanizer.getResponseDelay();
  return c.json({
    answer,
    delay,
    escalated: true,
    category,
    messageType,
    processingMs: Date.now() - startTime,
  });
}

// ===================== 체인 설정 로드 (DB → aiGateway) =====================
let chainOverridesLoadedAt = 0;
const CHAIN_OVERRIDES_CACHE_TTL = 300_000; // 5분

async function loadChainOverrides(): Promise<void> {
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
    chainOverridesLoadedAt = now; // 실패해도 캐시하여 반복 호출 방지
  }
}

// AI 카테고리 분류
async function classifyCategory(message: string): Promise<string> {
  try {
    const response = await aiGateway.generate({
      prompt: `다음 질문을 카테고리 하나로 분류하세요. 반드시 아래 중 하나만 출력하세요:
네이버트래픽, 블로그기자단, 인스타그램, 홈페이지, SEO, 영상촬영, 일반

질문: "${message}"

카테고리:`,
      systemPrompt: '카테고리 분류기입니다. 카테고리 이름만 출력하세요.',
      temperature: 0.1,
      complexity: 'simple',
    });
    const cat = response.text.trim().replace(/["\n]/g, '');
    return VALID_CATEGORIES.includes(cat) ? cat : '일반';
  } catch {
    return '일반';
  }
}
