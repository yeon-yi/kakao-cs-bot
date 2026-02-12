import { Hono } from 'hono';
import { createLogger, getEnv } from '@kakao-cs-bot/config';
import { KnowledgeRepository, ConversationRepository, EscalationRepository, ProactiveRepository } from '@kakao-cs-bot/database';
import { embedder, aiGateway, humanizer } from '@kakao-cs-bot/ai';

const logger = createLogger('api:webhook');

const knowledgeRepo = new KnowledgeRepository();
const conversationRepo = new ConversationRepository();
const escalationRepo = new EscalationRepository();
const proactiveRepo = new ProactiveRepository();

const ESCALATION_THRESHOLD = 0.5;
const VALID_CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

// Debug: webhook의 knowledgeRepo 검색 함수 export
export const webhookKnowledgeSearch = (embedding: number[], text: string) =>
  knowledgeRepo.search(embedding, text, { limit: 5 });

// 방별 마지막 응답 시간 (rate limiting)
const lastResponseMap = new Map<string, number>();
const MIN_INTERVAL_MS = 3000; // 같은 방에 최소 3초 간격

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

    // 0. 차단된 방 체크 (해지요청 등)
    const isBlocked = await proactiveRepo.isBlocked(roomId).catch(() => false);
    if (isBlocked) {
      return c.json({ answer: null, reason: 'room_blocked' });
    }

    // 1. 운영 시간 체크
    if (!humanizer.isOperatingHours()) {
      return c.json({ answer: null, reason: 'outside_hours' });
    }

    // 2. Rate limiting (같은 방 연속 응답 방지)
    const lastTime = lastResponseMap.get(roomId) || 0;
    if (Date.now() - lastTime < MIN_INTERVAL_MS) {
      return c.json({ answer: null, reason: 'rate_limited' });
    }

    // 3. 지식베이스 검색
    const embedding = await embedder.embed(message);
    const knowledge = await knowledgeRepo.search(embedding, message, { limit: 5 });

    const topSimilarity = knowledge.length > 0 ? (knowledge[0].similarity ?? 0) : 0;
    const needsEscalation = knowledge.length === 0 || topSimilarity < ESCALATION_THRESHOLD;

    let answer: string;
    let escalated = false;
    let category: string | null = null;
    let aiModel: string | null = null;
    let knowledgeTier: number | null = null;

    if (needsEscalation) {
      // 4a. 에스컬레이션: 봇이 답변 못하는 질문
      answer = humanizer.humanizeResponse(
        '확인 후 담당자가 안내드리겠습니다. 잠시만 기다려 주세요!',
        { isThankYou: false },
      );
      escalated = true;

      // AI 카테고리 분류
      category = await classifyCategory(message);

      // 대화 저장
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

      // 에스컬레이션 생성
      const assignee = await escalationRepo.getAssigneeByCategory(category).catch(() => null);

      await escalationRepo.create({
        conversation_id: conversation.id,
        room_id: roomId,
        user_id: userName || 'unknown',
        user_name: userName,
        user_message: message,
        bot_response: answer,
        category,
        confidence: topSimilarity,
        status: assignee ? 'assigned' : 'pending',
        assigned_to: assignee ? (assignee as any).staff_id : null,
        assigned_at: assignee ? new Date().toISOString() : null,
      });

      logger.info('Escalation created', { roomId, userName, category, similarity: topSimilarity });
    } else {
      // 4b. 정상 응답: 지식 기반 AI 답변
      const knowledgeContext = knowledge
        .map(k => `Q: ${k.question}\nA: ${k.answer}`)
        .join('\n\n');

      const systemPrompt = `당신은 광고 대행사의 CS 담당자입니다.
고객(광고주)의 질문에 친절하고 프로페셔널하게 답변합니다.

참고 지식:
${knowledgeContext}

규칙:
- 참고 지식을 바탕으로 정확하게 답변하세요
- 모르는 것은 확인 후 안내하겠다고 하세요
- 존댓말을 사용하세요
- 간결하게 답변하세요 (3문장 이내)`;

      const response = await aiGateway.generate({
        prompt: message,
        systemPrompt,
        temperature: 0.2,
      });

      aiModel = response.model;
      knowledgeTier = knowledge[0]?.tier ?? null;

      // 인간화
      const isThankYou = /감사|고마|ㄱㅅ/.test(message);
      answer = humanizer.humanizeResponse(response.text, { isThankYou });

      // 지식 사용 카운트 증가
      if (knowledge[0]?.id) {
        await knowledgeRepo.incrementUsage(knowledge[0].id).catch(() => {});
      }

      // 대화 저장
      await conversationRepo.create({
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

      logger.info('Response generated', {
        roomId, userName, model: aiModel,
        similarity: topSimilarity, tier: knowledgeTier,
        latencyMs: Date.now() - startTime,
      });
    }

    // 5. Rate limit 업데이트
    lastResponseMap.set(roomId, Date.now());

    // 6. 인간다운 딜레이 계산 (봇 앱에서 적용)
    const delay = humanizer.getResponseDelay();

    return c.json({
      answer,
      delay,
      escalated,
      category,
      confidence: topSimilarity,
      processingMs: Date.now() - startTime,
      _debug: {
        rawMessage: message,
        messageBytes: Buffer.from(message).toString('hex').slice(0, 60),
        embLen: embedding.length,
        embFirst3: embedding.slice(0, 3),
        knowledgeCount: knowledge.length,
        topQ: knowledge[0]?.question,
        allSims: knowledge.map((k: any) => k.similarity),
      },
    });
  } catch (error) {
    logger.error('Webhook error', { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// 상태 확인 엔드포인트 (봇 앱 연결 테스트용)
webhookApp.get('/status', async (c) => {
  return c.json({
    status: 'ok',
    operatingHours: humanizer.isOperatingHours(),
    timestamp: new Date().toISOString(),
  });
});

// ===================== 프로액티브 메시징 엔드포인트 (봇 앱용) =====================

// 대기중인 인사 메시지 조회 (봇 앱 폴링)
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

// 전송 결과 보고 (봇 앱 → API)
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

// n8n cron → 비활성 방 자동 인사 생성
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

// 방 차단 여부 확인 (봇 앱에서 캐시용)
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
