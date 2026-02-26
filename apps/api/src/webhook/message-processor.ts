// ===================== 메시지 처리 핵심 로직 =====================
import { createLogger } from '@kakao-cs-bot/config';
import {
  KnowledgeRepository,
  ConversationRepository,
  ProactiveRepository,
  IdentityRepository,
} from '@kakao-cs-bot/database';
import { embedder, aiGateway, humanizer } from '@kakao-cs-bot/ai';
import type { NonTextMessageParams } from './types';
import {
  MESSAGE_BUFFER_MS, SOFT_ESCALATION_SUFFIXES,
  PHOTO_RESPONSE_TEMPLATES, VIDEO_RESPONSE_TEMPLATES,
  SARCASM_PATTERNS, COMPLAINT_WITH_THANKS,
  PURE_POSITIVE_PATTERNS, NEGATIVE_PATTERNS,
  GREETING_TEMPLATES,
} from './constants';
import {
  getRedis, getResponseCache, getWebhookConfig,
  isOperatingHoursFromConfig, getStaffNameMap,
  getLearnedToneProfile, getSystemPrompt, loadChainOverrides,
} from './config-cache';
import { detectCustomerTone, buildToneMirrorInstructions, updateCustomerProfile } from './tone-analyzer';
import {
  createEscalation, getEscalationMessage,
  classifyCategory, recordUncertainty,
} from './escalation-service';

const logger = createLogger('api:webhook:message');
const knowledgeRepo = new KnowledgeRepository();
const conversationRepo = new ConversationRepository();
const proactiveRepo = new ProactiveRepository();
const identityRepo = new IdentityRepository();

// ===================== 대화 히스토리 포맷팅 =====================
export async function getConversationHistory(roomId: string, userName: string): Promise<string> {
  try {
    const history = await conversationRepo.getHistory(roomId, userName, 12);
    if (!history || history.length === 0) return '';

    const ordered = history.reverse();
    const recentCount = Math.min(5, ordered.length);
    const olderItems = ordered.slice(0, ordered.length - recentCount);
    const recentItems = ordered.slice(ordered.length - recentCount);

    const parts: string[] = [];

    if (olderItems.length > 0) {
      const summary = olderItems.map((h: any) => {
        const q = h.user_message ? h.user_message.substring(0, 50) : '';
        const a = h.bot_response ? h.bot_response.substring(0, 50) : '';
        return `고객:"${q}${h.user_message?.length > 50 ? '...' : ''}" → 답변:"${a}${h.bot_response?.length > 50 ? '...' : ''}"`;
      }).join(' | ');
      parts.push(`[이전 대화 요약] ${summary}`);
    }

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

// ===================== 코사인 유사도 =====================
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

// ===================== 암시적 피드백 감지 =====================
async function checkImplicitFeedback(
  roomId: string, userName: string, currentMessage: string, currentEmbedding: number[]
): Promise<void> {
  try {
    const redisClient = getRedis();
    const prevKey = `lastconv:${roomId}:${userName}`;
    const prevData = await redisClient.get(prevKey);
    if (!prevData) return;

    const prev = JSON.parse(prevData);
    const prevConvId = prev.conversationId;
    const prevKnowledgeId = prev.knowledgeId;

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

    if (feedbackRecorded) {
      await redisClient.del(prevKey);
    }
  } catch (e) {
    logger.warn('Implicit feedback check failed', { error: String(e) });
  }
}

// ===================== 메인 메시지 처리 =====================
export async function processMessage(c: any): Promise<Response> {
  const startTime = Date.now();

  try {
    const body = await c.req.json();
    const { roomId, userName, message, isGroupChat, messageType, imageUrl } = body;
    const effectiveMessageType: string = messageType || 'text';

    if (!roomId || !message) {
      return c.json({ error: 'roomId and message are required' }, 400);
    }

    // 0-0. 무의미 메시지 서버 사이드 필터
    const SKIP_SERVER_PATTERNS = [
      /^[!?.,;:~·…\s]+$/,           // 순수 특수문자/구두점만
      /^[ㅋㅎㅠㅜㅇ]{1,}$/,          // 자음 반복
      /^(ㅇㅇ|ㅇㅋ|ㅎㅇ|ㄴㄴ|ㄱㄱ|ㄱㅅ|ㅋㅋ|ㅎㅎ|넵|넹|ㅇ|ㅋ|ㅎ)$/,
      /^이모티콘$/,
    ];
    if (SKIP_SERVER_PATTERNS.some(p => p.test(message.trim()))) {
      return c.json({ answer: null, reason: 'skip_pattern' });
    }

    // 0-1. 발신자 직원 여부 자동 감지
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

    // 0-2. 차단된 방 + 설정 배치 로드
    const [isBlocked, webhookConfig] = await Promise.all([
      proactiveRepo.isBlocked(roomId).catch(() => false),
      getWebhookConfig(),
    ]);
    if (isBlocked) {
      return c.json({ answer: null, reason: 'room_blocked' });
    }

    // 0-3. 봇 모드 체크
    if (webhookConfig.botMode === 'off') {
      return c.json({ answer: null, reason: 'bot_disabled' });
    }

    let isTestMode = false;
    if (webhookConfig.botMode === 'test') {
      if (webhookConfig.testRooms.length === 0 || !webhookConfig.testRooms.includes(roomId)) {
        return c.json({ answer: null, reason: 'test_mode_excluded' });
      }
      isTestMode = true;
    }

    // 0-4. 사진/미디어 메시지
    if (effectiveMessageType !== 'text') {
      return await handleNonTextMessage(c, {
        roomId, userName: userName || 'unknown', message,
        isGroupChat, messageType: effectiveMessageType, imageUrl,
        startTime,
      });
    }

    // 1. 운영 시간 체크
    if (!isTestMode && !isOperatingHoursFromConfig(webhookConfig)) {
      return c.json({ answer: null, reason: 'outside_hours' });
    }

    // 2. 메시지 배칭
    const redisClient = getRedis();
    const bufferKey = `msgbuf:${roomId}`;
    const nonceKey = `msgnonce:${roomId}`;

    await redisClient.rpush(bufferKey, message);
    await redisClient.expire(bufferKey, 30);

    const myNonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await redisClient.set(nonceKey, myNonce, 'EX', 30);

    await new Promise(resolve => setTimeout(resolve, MESSAGE_BUFFER_MS));

    const latestNonce = await redisClient.get(nonceKey);
    if (latestNonce !== myNonce) {
      return c.json({ answer: null, reason: 'buffering' });
    }

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

    await checkImplicitFeedback(roomId, userName || 'unknown', combinedMessage, embedding);

    const topSimilarity = knowledge.length > 0 ? (knowledge[0].similarity ?? 0) : 0;
    const threshold = webhookConfig.escalationThreshold;
    const softEscalationThreshold = Math.min(threshold + 0.15, 0.65);
    const needsEscalation = knowledge.length === 0 || topSimilarity < threshold;
    const isSoftEscalation = !needsEscalation && topSimilarity < softEscalationThreshold;

    let answer = '';
    let escalated = false;
    let category: string | null = null;
    let aiModel: string | null = null;
    let knowledgeTier: number | null = null;
    let conversationId: number | null = null;
    let usedKnowledgeId: string | null = null;
    let fromCache = false;

    const historyContext = await getConversationHistory(roomId, userName || 'unknown');

    // 캐시 조회
    if (!needsEscalation) {
      try {
        const cached = await getResponseCache().get(combinedMessage);
        if (cached && cached.confidence >= topSimilarity * 0.9) {
          const isThankYou = /감사|고마|ㄱㅅ/.test(combinedMessage);
          const customerToneForHumanizer = detectCustomerTone(combinedMessage, historyContext);
          answer = humanizer.humanizeResponse(cached.answer, {
            isThankYou,
            customerMessage: combinedMessage,
            hasHistory: historyContext.length > 0,
            customerFormality: customerToneForHumanizer.formalityLevel,
          });
          aiModel = cached.model + ' (cached)';
          knowledgeTier = knowledge[0]?.tier ?? null;
          usedKnowledgeId = knowledge[0]?.id ?? null;
          fromCache = true;

          const conversation = await conversationRepo.create({
            room_id: roomId,
            user_id: userName || 'unknown',
            user_name: userName,
            user_message: combinedMessage,
            bot_response: answer,
            context: { isGroupChat, cached: true },
            knowledge_tier: knowledgeTier,
            ai_model: aiModel,
            confidence: topSimilarity,
            response_time_ms: Date.now() - startTime,
          });
          conversationId = conversation?.id;

          logger.info('Cache hit response', { roomId, model: cached.model, processingMs: Date.now() - startTime });
        }
      } catch (e) {
        logger.warn('Cache lookup failed', { error: String(e) });
      }
    }

    if (fromCache) {
      // 캐시 히트 완료
    } else if (needsEscalation) {
      // 4a-1. 범위 외 질문 체크 (유사도 매우 낮을 때)
      if (topSimilarity < 0.3) {
        const inScope = await checkIfInScope(combinedMessage);
        if (!inScope) {
          const outOfScopeAnswer = '해당 내용은 저희 서비스 범위가 아니라 안내가 어렵습니다. 저희는 네이버/인스타그램/블로그 마케팅을 전문으로 하고 있습니다.';
          await conversationRepo.create({
            room_id: roomId, user_id: userName || 'unknown', user_name: userName,
            user_message: combinedMessage, bot_response: outOfScopeAnswer,
            context: { isGroupChat, outOfScope: true },
            knowledge_tier: null, ai_model: null, confidence: topSimilarity,
            response_time_ms: Date.now() - startTime,
          });
          logger.info('Out-of-scope rejected', { roomId, userName, similarity: topSimilarity });
          return c.json({
            answer: outOfScopeAnswer, delay: humanizer.getResponseDelay(),
            escalated: false, confidence: topSimilarity, processingMs: Date.now() - startTime,
          });
        }
      }

      // 4a-2. 연속 에스컬레이션 감지 → 3회 이상이면 무응답
      const recentHistory = await conversationRepo.getHistory(roomId, userName || 'unknown', 5).catch(() => []);
      const recentEscCount = (recentHistory || []).filter((c: any) =>
        c.bot_response && /확인.*안내|담당자.*확인|잠시만.*기다려|확인 중/.test(c.bot_response)
      ).length;

      if (recentEscCount >= 4) {
        // 4회 이상 연속 에스컬레이션 → 에스컬레이션 생성만 하고 무응답
        await createEscalation({
          roomId, userName: userName || 'unknown',
          message: combinedMessage, answer: '',
          confidence: topSimilarity, conversationId: null,
          escalationType: 'low_confidence', includeContext: true,
        });
        logger.info('Consecutive escalation suppressed', { roomId, count: recentEscCount });
        return c.json({ answer: null, reason: 'consecutive_escalation' });
      }

      // 4a-3. 에스컬레이션 응답 (횟수에 따라 다른 템플릿)
      answer = humanizer.humanizeResponse(getEscalationMessage(recentEscCount), { isThankYou: false });
      escalated = true;

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

      // 통합 에스컬레이션 생성 (컨텍스트 포함)
      await createEscalation({
        roomId, userName: userName || 'unknown',
        message: combinedMessage, answer,
        confidence: topSimilarity,
        conversationId: conversation?.id,
        escalationType: 'low_confidence',
        includeContext: true,
      });

      await recordUncertainty(combinedMessage, '일반', topSimilarity).catch(() => {});

      logger.info('Escalation created', { roomId, userName, similarity: topSimilarity, threshold, escCount: recentEscCount });
    } else {
      // 4b. 정상 응답
      const knowledgeContext = knowledge
        .map(k => `Q: ${k.question}\nA: ${k.answer}`)
        .join('\n\n');

      await loadChainOverrides();
      const strategy = aiGateway.resolveChainStrategy();
      let responseText: string;
      let chainStepsJson: any = null;

      if (strategy.mode !== 'single') {
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
        const customerToneForPrompt = detectCustomerTone(combinedMessage, historyContext);
        const toneMirrorInstructions = buildToneMirrorInstructions(customerToneForPrompt);
        const learnedTone = await getLearnedToneProfile();
        const systemPrompt = await getSystemPrompt(
          knowledgeContext, historyContext, combinedMessage,
          toneMirrorInstructions, learnedTone, customerToneForPrompt.honorific,
        );
        // similarity 0.6 미만 → gpt-4o (complex), 이상 → gpt-4o-mini (simple)
        const useComplexModel = topSimilarity < 0.6;
        const response = await aiGateway.generate({
          prompt: combinedMessage,
          systemPrompt,
          temperature: 0.3,
          complexity: useComplexModel ? 'complex' : 'simple',
        });
        responseText = response.text;
        aiModel = response.model;
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

      const isThankYou = /감사|고마|ㄱㅅ/.test(combinedMessage);
      const customerToneForHumanizer = detectCustomerTone(combinedMessage, historyContext);
      answer = humanizer.humanizeResponse(responseText, {
        isThankYou,
        customerMessage: combinedMessage,
        hasHistory: historyContext.length > 0,
        customerFormality: customerToneForHumanizer.formalityLevel,
      });

      // Soft-escalation
      if (isSoftEscalation) {
        answer += SOFT_ESCALATION_SUFFIXES[Math.floor(Math.random() * SOFT_ESCALATION_SUFFIXES.length)];
        escalated = true;
      }

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

      // 캐시 저장 (soft-escalation 제외)
      if (!isSoftEscalation) {
        try {
          await getResponseCache().set(combinedMessage, answer, topSimilarity, aiModel || 'unknown');
        } catch (e) {
          logger.warn('Cache set failed', { error: String(e) });
        }
      }

      // Soft-escalation 레코드 생성
      if (isSoftEscalation && conversationId) {
        try {
          await createEscalation({
            roomId, userName: userName || 'unknown',
            message: combinedMessage, answer,
            confidence: topSimilarity,
            conversationId,
            escalationType: 'soft',
          });
        } catch (e) {
          logger.warn('Soft-escalation record failed', { error: String(e) });
        }
      }

      // hedging → 불확실 주제 기록
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

    // 5. 암시적 피드백용 데이터 저장
    if (conversationId && !escalated) {
      try {
        await getRedis().setex(
          `lastconv:${roomId}:${userName || 'unknown'}`,
          600,
          JSON.stringify({
            conversationId,
            knowledgeId: usedKnowledgeId,
            embedding: embedding.slice(0, 100),
          })
        );
      } catch {}
    }

    // 6. 고객 프로필 업데이트
    const detectedTone = detectCustomerTone(combinedMessage, historyContext);
    updateCustomerProfile(roomId, detectedTone).catch(() => {});

    // 7. 응답 반환
    const delay = humanizer.getResponseDelay();
    const messages = humanizer.splitIntoMessages(answer);

    return c.json({
      answer: messages[0]?.text || answer,
      delay,
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
}

// ===================== 범위 판별 =====================
async function checkIfInScope(message: string): Promise<boolean> {
  try {
    const response = await aiGateway.generate({
      prompt: `이 질문이 온라인 마케팅/광고 대행사 서비스와 관련 있는지 판별하세요.
서비스 범위: 네이버트래픽, 블로그기자단, 인스타그램 마케팅, 홈페이지 제작, SEO, 영상촬영, 온라인 광고 전반
광고주의 광고 진행상황/결과/비용/계약 문의도 범위 내입니다.
일반적인 인사나 안부도 범위 내입니다.

질문: "${message}"

관련 있으면 YES, 없으면 NO만 출력:`,
      systemPrompt: 'YES 또는 NO만 출력하세요.',
      temperature: 0.1,
      complexity: 'simple',
    });
    return response.text.trim().toUpperCase().startsWith('YES');
  } catch {
    return true; // 에러 시 범위 내로 간주 (안전)
  }
}

// ===================== 비텍스트 메시지 처리 =====================
export async function handleNonTextMessage(c: any, params: NonTextMessageParams): Promise<Response> {
  const { roomId, userName, message, isGroupChat, messageType, imageUrl, startTime } = params;

  const templates = messageType === 'video' ? VIDEO_RESPONSE_TEMPLATES : PHOTO_RESPONSE_TEMPLATES;
  const templateResponse = templates[Math.floor(Math.random() * templates.length)];
  const answer = humanizer.humanizeResponse(templateResponse, { isThankYou: false });

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

  // 최근 대화 맥락 첨부
  let contextSummary = '';
  try {
    const historyText = await getConversationHistory(roomId, userName);
    if (historyText) contextSummary = historyText.substring(0, 500);
  } catch {}

  // 통합 에스컬레이션 생성
  await createEscalation({
    roomId, userName, answer,
    message: `[${messageType === 'video' ? '영상' : '사진'}] ${message}`,
    confidence: null,
    conversationId: conversation?.id,
    escalationType: messageType === 'video' ? 'video' : 'photo',
    contextOverride: contextSummary || undefined,
  });

  logger.info('Non-text message escalated', {
    roomId, userName, messageType, category,
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
