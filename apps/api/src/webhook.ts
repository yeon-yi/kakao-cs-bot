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
  if (!redis) redis = new Redis(getEnv().REDIS_URL);
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
    const val = parseFloat(config?.value ?? '0.5');
    cachedThreshold = { value: isNaN(val) ? 0.5 : val, loadedAt: now };
  } catch {
    cachedThreshold = { value: 0.5, loadedAt: now };
  }
  return cachedThreshold.value;
}

// ===================== 프롬프트 (대화 히스토리 지원) =====================
let cachedPrompt: { template: string; loadedAt: number } | null = null;
const PROMPT_CACHE_TTL = 300000;

async function getSystemPrompt(knowledgeContext: string, historyContext: string): Promise<string> {
  const now = Date.now();
  if (!cachedPrompt || now - cachedPrompt.loadedAt > PROMPT_CACHE_TTL) {
    const row = await promptRepo.get('default_answer').catch(() => null);
    if (row?.template) {
      cachedPrompt = { template: row.template, loadedAt: now };
    }
  }

  if (cachedPrompt?.template) {
    return cachedPrompt.template
      .replace('{{context}}', knowledgeContext)
      .replace('{{history}}', historyContext);
  }

  // DB에서 로드 실패 시 기본 프롬프트 (강화된 버전)
  return `당신은 온라인 마케팅/광고 대행사 CS팀의 숙련된 직원입니다.
카카오톡으로 고객(광고주)과 대화합니다.

대화 스타일:
- "~합니다", "~드리겠습니다", "~알겠습니다" 등 프로페셔널한 존댓말 사용
- 대기업 CS 담당자처럼 신뢰감 있고 정중하게
- 2~4문장 이내로 간결하고 핵심적으로 답변
- 고객이 불만이면 먼저 사과: "불편을 드려 죄송합니다"
- 이전 대화 내용을 자연스럽게 이어가기
- 확신 있는 정보만 전달, 불확실하면 "확인 후 안내드리겠습니다"

절대 하지 않을 것:
- AI라는 것을 직간접적으로 드러내기
- "~요" 체 사용 (예: 알려드릴게요 X → 알려드리겠습니다 O)
- 매번 같은 패턴의 인사나 마무리
- "도움이 필요하시면 말씀해주세요" 같은 로봇적 마무리를 매번 붙이기
- 이모지 남발 (최소한으로만 사용)
- 초보자 느낌이 나는 불확실한 답변

최근 대화:
${historyContext || '(첫 대화)'}

참고 지식:
${knowledgeContext}`;
}

// ===================== 대화 히스토리 포맷팅 =====================
async function getConversationHistory(roomId: string, userName: string): Promise<string> {
  try {
    const history = await conversationRepo.getHistory(roomId, userName, 5);
    if (!history || history.length === 0) return '';

    // 최신→오래된 순으로 반환되므로 reverse
    return history.reverse().map((h: any) => {
      const parts: string[] = [];
      if (h.user_message) parts.push(`[고객] ${h.user_message}`);
      if (h.bot_response) parts.push(`[나] ${h.bot_response}`);
      return parts.join('\n');
    }).join('\n\n');
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

    if (isSarcastic) {
      await conversationRepo.markHelpful(prevConvId, false);
      if (prevKnowledgeId) {
        await knowledgeRepo.adjustConfidence(prevKnowledgeId, -0.1).catch(() => {});
      }
      logger.debug('Sarcastic negative feedback detected', { roomId, convId: prevConvId });
    } else if (PURE_POSITIVE_PATTERNS.test(currentMessage) && !COMPLAINT_WITH_THANKS.test(currentMessage)) {
      await conversationRepo.markHelpful(prevConvId, true);
      if (prevKnowledgeId) {
        await knowledgeRepo.adjustConfidence(prevKnowledgeId, 0.05).catch(() => {});
      }
      logger.debug('Implicit positive feedback', { roomId, convId: prevConvId });
    } else if (NEGATIVE_PATTERNS.test(currentMessage)) {
      await conversationRepo.markHelpful(prevConvId, false);
      if (prevKnowledgeId) {
        await knowledgeRepo.adjustConfidence(prevKnowledgeId, -0.1).catch(() => {});
      }
      logger.debug('Implicit negative feedback', { roomId, convId: prevConvId });
    }

    // 같은 질문 반복 감지 (similarity > 0.85)
    if (prev.embedding && currentEmbedding) {
      const similarity = cosineSimilarity(currentEmbedding, prev.embedding);
      if (similarity > 0.85) {
        await conversationRepo.markHelpful(prevConvId, false);
        if (prevKnowledgeId) {
          await knowledgeRepo.adjustConfidence(prevKnowledgeId, -0.15).catch(() => {});
        }
        logger.debug('Repeated question detected', { roomId, similarity });
      }
    }

    // 처리 후 삭제
    await redisClient.del(prevKey);
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

// 방별 마지막 응답 시간 (rate limiting)
const lastResponseMap = new Map<string, number>();
const MIN_INTERVAL_MS = 3000;

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
    const { roomId, userName, message, isGroupChat } = body;

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

    // 1. 운영 시간 체크
    if (!humanizer.isOperatingHours()) {
      return c.json({ answer: null, reason: 'outside_hours' });
    }

    // 2. Rate limiting
    const lastTime = lastResponseMap.get(roomId) || 0;
    if (Date.now() - lastTime < MIN_INTERVAL_MS) {
      return c.json({ answer: null, reason: 'rate_limited' });
    }

    // 3. 임베딩 + 지식베이스 검색
    const embedding = await embedder.embed(message);
    const knowledge = await knowledgeRepo.search(embedding, message, { limit: 5 });

    // 3-1. 암시적 피드백 체크 (이전 대화에 대한 반응)
    await checkImplicitFeedback(roomId, userName || 'unknown', message, embedding);

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

      category = await classifyCategory(message);

      const conversation = await conversationRepo.create({
        room_id: roomId,
        user_id: userName || 'unknown',
        user_name: userName,
        user_message: message,
        bot_response: answer,
        context: { isGroupChat },
        knowledge_tier: null,
        ai_model: null,
        confidence: topSimilarity,
        response_time_ms: Date.now() - startTime,
      });
      conversationId = conversation?.id;

      // 에스컬레이션 담당자 배정
      let assignedStaffId: number | null = null;
      let assignedSource = '';

      const roomStaff = await findStaffInRoom(roomId).catch(() => null);
      if (roomStaff) {
        assignedStaffId = roomStaff.staffId;
        assignedSource = `room_staff:${roomStaff.staffName}`;
      }

      if (!assignedStaffId) {
        const categoryAssignee = await escalationRepo.getAssigneeByCategory(category).catch(() => null);
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
        user_message: message,
        bot_response: answer,
        category,
        confidence: topSimilarity,
        status: assignedStaffId ? 'assigned' : 'pending',
        assigned_to: assignedStaffId,
        assigned_at: assignedStaffId ? new Date().toISOString() : null,
      });

      // 불확실 주제 기록
      await recordUncertainty(message, category || '일반', topSimilarity).catch(() => {});

      logger.info('Escalation created', { roomId, userName, category, similarity: topSimilarity, threshold, assignedTo: assignedSource || 'none' });
    } else {
      // 4b. 정상 응답
      const knowledgeContext = knowledge
        .map(k => `Q: ${k.question}\nA: ${k.answer}`)
        .join('\n\n');

      const systemPrompt = await getSystemPrompt(knowledgeContext, historyContext);

      const response = await aiGateway.generate({
        prompt: message,
        systemPrompt,
        temperature: 0.3,
      });

      aiModel = response.model;
      knowledgeTier = knowledge[0]?.tier ?? null;
      usedKnowledgeId = knowledge[0]?.id ?? null;

      // 인간화 (톤 분석 포함)
      const isThankYou = /감사|고마|ㄱㅅ/.test(message);
      answer = humanizer.humanizeResponse(response.text, {
        isThankYou,
        customerMessage: message,
        hasHistory: historyContext.length > 0,
      });

      if (knowledge[0]?.id) {
        await knowledgeRepo.incrementUsage(knowledge[0].id).catch(() => {});
      }

      const conversation = await conversationRepo.create({
        room_id: roomId,
        user_id: userName || 'unknown',
        user_name: userName,
        user_message: message,
        bot_response: answer,
        context: { isGroupChat },
        knowledge_tier: knowledgeTier,
        ai_model: aiModel,
        confidence: topSimilarity,
        response_time_ms: Date.now() - startTime,
      });
      conversationId = conversation?.id;

      // hedging 감지 → 불확실 주제 기록
      if (/정확하지 않을 수|확인이 필요|아마|추후 확인/.test(answer)) {
        await recordUncertainty(message, knowledge[0]?.category || '일반', topSimilarity, 'hedging').catch(() => {});
      }

      logger.info('Response generated', {
        roomId, userName, model: aiModel,
        similarity: topSimilarity, tier: knowledgeTier,
        latencyMs: Date.now() - startTime,
      });
    }

    // 5. Rate limit 업데이트
    lastResponseMap.set(roomId, Date.now());

    // 6. 암시적 피드백을 위해 현재 대화 정보 Redis에 저장 (TTL 10분)
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

    // 7. 인간다운 딜레이 계산
    const delay = humanizer.getResponseDelay();

    return c.json({
      answer,
      delay,
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
