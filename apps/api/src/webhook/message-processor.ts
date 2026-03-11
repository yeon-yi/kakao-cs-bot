// ===================== 메시지 처리 핵심 로직 =====================
import { createLogger } from '@kakao-cs-bot/config';
import {
  KnowledgeRepository,
  ConversationRepository,
  ProactiveRepository,
  IdentityRepository,
  queryOne as dbQueryOne,
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
import { detectCustomerTone, buildToneMirrorInstructions, updateCustomerProfile, getCustomerProfile } from './tone-analyzer';
import {
  createEscalation, getEscalationMessage,
  classifyCategory, recordUncertainty,
  resolveAssignee,
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

    // 반복 패턴 감지: 이전 응답들에서 중복되는 표현 추출
    const recentResponses = recentItems
      .map((h: any) => h.bot_response || '')
      .filter((r: string) => r.length > 0);
    const warnings: string[] = [];

    // 인사 중복 감지 (다양한 인사 변형 포함)
    const alreadyGreeted = recentResponses.some((r: string) =>
      /^(안녕하세요|안녕하세요\s)/.test(r.trim()) || /안녕하세요\s*(대표님|담당자님)/.test(r)
    );
    if (alreadyGreeted) {
      warnings.push('[주의] 이 대화에서 이미 인사했음 → 인사("안녕하세요") 생략하고 바로 본론');
    }

    // 반복 표현 감지 (확장된 패턴)
    const phraseCounts = new Map<string, number>();
    for (const r of recentResponses) {
      const phrases = [
        /감사합니다/.test(r) ? '감사합니다' : null,
        /확인.*안내|안내.*드리겠/.test(r) ? '확인 후 안내' : null,
        /담당자.*바쁜|담당자.*실무|담당자.*미팅/.test(r) ? '담당자 바쁨 언급' : null,
        /톡방.*남겨|전달.*확인|남겨.*주시면/.test(r) ? '톡방에 남겨달라는 요청' : null,
        /죄송|불편.*드려/.test(r) ? '사과 표현' : null,
        /빠르게.*처리|신속.*처리|바로.*확인/.test(r) ? '빠른 처리 약속' : null,
        /구체적.*말씀|어떤.*부분|문제.*말씀/.test(r) ? '되묻기' : null,
      ].filter(Boolean) as string[];
      for (const p of phrases) {
        phraseCounts.set(p, (phraseCounts.get(p) || 0) + 1);
      }
    }
    for (const [phrase, count] of phraseCounts) {
      if (count >= 2) {
        warnings.push(`[주의] "${phrase}"을(를) 이미 ${count}회 사용함 → 같은 표현 반복 금지, 다른 방식으로 표현`);
      }
    }

    // 연속 응답 텍스트 유사도 체크 (단어 겹침 기반)
    if (recentResponses.length >= 2) {
      const last = recentResponses[recentResponses.length - 1];
      const prev = recentResponses[recentResponses.length - 2];
      const lastWords = new Set(last.split(/\s+/).filter((w: string) => w.length > 1));
      const prevWords = new Set(prev.split(/\s+/).filter((w: string) => w.length > 1));
      if (lastWords.size > 0 && prevWords.size > 0) {
        let overlap = 0;
        for (const w of lastWords) { if (prevWords.has(w)) overlap++; }
        const similarity = overlap / Math.max(lastWords.size, prevWords.size);
        if (similarity > 0.6) {
          warnings.push(`[주의] 직전 두 응답이 ${Math.round(similarity * 100)}% 유사함 → 반드시 다른 표현과 구조로 답변`);
        }
      }
    }

    if (warnings.length > 0) {
      parts.push(warnings.join('\n'));
    }

    return parts.join('\n\n');
  } catch {
    return '';
  }
}

// ===================== 방 전체 대화 맥락 (봇 태그 시 사용) =====================
async function getRoomContextForMention(roomId: string): Promise<string> {
  try {
    const history = await conversationRepo.getRoomHistory(roomId, 15);
    if (!history || history.length === 0) return '(이 방의 대화 기록 없음)';

    const ordered = history.reverse();
    const parts: string[] = [];
    const answeredQuestions = new Set<string>();

    for (const h of ordered) {
      const lines: string[] = [];
      const sender = h.user_name || '사용자';
      if (h.user_message) lines.push(`[${sender}] ${h.user_message}`);
      if (h.bot_response) {
        lines.push(`[봇 응답] ${h.bot_response}`);
        // 이미 답변된 질문 추적
        if (h.user_message) answeredQuestions.add(h.user_message.substring(0, 30));
      }
      if (lines.length > 0) parts.push(lines.join('\n'));
    }

    const context = parts.join('\n\n');
    const answeredNote = answeredQuestions.size > 0
      ? `\n\n[이미 답변된 질문 ${answeredQuestions.size}건 - 중복 답변하지 말 것]`
      : '';

    return context + answeredNote;
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

    // 0-1. 차단된 방 + 설정 배치 로드 (직원 감지보다 먼저 - 테스트모드 판별 필요)
    const [isBlocked, webhookConfig] = await Promise.all([
      proactiveRepo.isBlocked(roomId).catch(() => false),
      getWebhookConfig(),
    ]);
    if (isBlocked) {
      return c.json({ answer: null, reason: 'room_blocked' });
    }

    // 0-2. 봇 모드 체크
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

    // 0-3. 봇 멘션(@태그) 감지 (쉼표 구분으로 여러 이름 지원)
    const botNames = webhookConfig.botKakaoName
      ? webhookConfig.botKakaoName.split(',').map(n => n.trim()).filter(Boolean)
      : [];
    let matchedBotName = '';
    const isBotMentioned = botNames.some(name => {
      if (message.includes(`@${name}`) || message.includes(name)) {
        matchedBotName = name;
        return true;
      }
      return false;
    });

    // 0-4. 발신자 직원 여부 자동 감지
    let isStaffSender = false;
    if (!isTestMode && userName) {
      try {
        // 0차: 이 방에서 이미 광고주로 확인된 사용자는 직원 감지 건너뜀
        const existingMember = await identityRepo.getRoomMember(roomId, userName).catch(() => null);
        if (existingMember && existingMember.role === 'advertiser' && existingMember.confidence >= 0.9) {
          // 관리자가 광고주로 확인한 사용자 → 직원 감지 안 함 (이름 충돌 방지)
        } else {
          // 1차: company_staff 테이블의 kakao_name 매칭
          const staffMap = await getStaffNameMap();
          let isStaff = !!staffMap.get(userName);

          // 2차: staff_aliases 테이블 매칭 (별칭/닉네임 변경 대비)
          if (!isStaff) {
            const alias = await identityRepo.findStaffByAlias(userName).catch(() => null);
            if (alias) isStaff = true;
          }

          // 3차: 다른 방에서 이미 company_staff로 확인된 사용자
          if (!isStaff) {
            const knownStaff = await identityRepo.isKnownStaff(userName).catch(() => false);
            if (knownStaff) isStaff = true;
          }

          if (isStaff) {
            isStaffSender = true;
            await identityRepo.upsertRoomMember(roomId, userName, userName, 'company_staff', 1.0);

            // 직원 메시지 처리 분기:
            // - 1:1 채팅: 직원도 AI 응답 받을 수 있음
            // - 그룹 채팅 + 봇 태그: 방의 최근 대화 맥락 분석 후 응답
            // - 그룹 채팅 + 태그 없음: 응답하지 않음
            if (isGroupChat && !isBotMentioned) {
              return c.json({ answer: null, reason: 'staff_message' });
            }
            // 1:1 채팅이거나 봇 태그된 경우 → 아래로 진행하여 응답
          } else {
            await identityRepo.upsertRoomMember(roomId, userName, userName, 'advertiser', 0.5);
          }
        }
      } catch (e) {
        logger.warn('Staff detection failed', { error: String(e) });
      }
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

    let combinedMessage = bufferedMessages.length > 1
      ? bufferedMessages.join('\n')
      : message;

    // 봇 멘션 시 멘션 텍스트 제거한 실제 질문 사용
    if (isBotMentioned && matchedBotName) {
      for (const name of botNames) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        combinedMessage = combinedMessage.replace(new RegExp(`@?${escaped}`, 'g'), '');
      }
      combinedMessage = combinedMessage.trim();
      if (!combinedMessage) combinedMessage = message; // 멘션만 있는 경우 원본 사용
      logger.info('Bot mentioned', { roomId, userName, originalMessage: message, cleanedMessage: combinedMessage });
    }

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

    // 봇 태그 시: 방 전체 대화 맥락 사용 (이미 답변된 건 표시)
    // 일반 메시지: 해당 사용자의 대화 기록만 사용
    const historyContext = isBotMentioned
      ? await getRoomContextForMention(roomId)
      : await getConversationHistory(roomId, userName || 'unknown');
    const customerProfile = isStaffSender ? null : await getCustomerProfile(roomId).catch(() => null);

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

      // 4a-2. 연속 에스컬레이션 감지 → 학습된 지식으로 응답 시도
      const recentHistory = await conversationRepo.getHistory(roomId, userName || 'unknown', 10).catch(() => []);
      const recentEscCount = (recentHistory || []).filter((c: any) =>
        c.bot_response && /확인.*안내|담당자.*확인|잠시만.*기다려|확인 중/.test(c.bot_response)
      ).length;

      if (recentEscCount >= 4) {
        // 학습된 Tier 1 지식에서 유사 답변 검색 (embedding은 Step 3에서 이미 생성됨)
        const learnedKnowledge = await knowledgeRepo.search(embedding, combinedMessage, {
          tier: 1,
          limit: 3,
        });

        if (learnedKnowledge.length > 0 && learnedKnowledge[0].similarity >= 0.35) {
          // 학습된 지식을 컨텍스트로 AI 응답 생성 (신뢰도 표시)
          const lkContext = learnedKnowledge
            .map(k => {
              const sim = k.similarity ?? 0;
              const confidence = sim >= 0.8 ? '[정확도: 높음]' : sim >= 0.6 ? '[정확도: 보통]' : '[정확도: 낮음 - 참고만]';
              return `${confidence}\nQ: ${k.question}\nA: ${k.answer}`;
            })
            .join('\n\n');

          const customerTone = detectCustomerTone(combinedMessage, historyContext);
          const toneMirror = buildToneMirrorInstructions(customerTone);
          const learnedTone = await getLearnedToneProfile();
          const lkSystemPrompt = await getSystemPrompt(
            lkContext, historyContext, combinedMessage,
            toneMirror, learnedTone, customerTone.honorific, customerProfile,
          );

          const lkResponse = await aiGateway.generate({
            prompt: combinedMessage,
            systemPrompt: lkSystemPrompt,
            temperature: 0.3,
            complexity: 'complex',
          });

          const isThankYouLk = /감사|고마|ㄱㅅ/.test(combinedMessage);
          answer = humanizer.humanizeResponse(lkResponse.text, {
            isThankYou: isThankYouLk,
            customerMessage: combinedMessage,
            hasHistory: historyContext.length > 0,
            customerFormality: customerTone.formalityLevel,
          });

          answer += SOFT_ESCALATION_SUFFIXES[Math.floor(Math.random() * SOFT_ESCALATION_SUFFIXES.length)];
          escalated = true;

          const lkConversation = await conversationRepo.create({
            room_id: roomId,
            user_id: userName || 'unknown',
            user_name: userName,
            user_message: combinedMessage,
            bot_response: answer,
            context: { isGroupChat, learnedFallback: true },
            knowledge_tier: learnedKnowledge[0].tier,
            ai_model: lkResponse.model,
            confidence: learnedKnowledge[0].similarity,
            response_time_ms: Date.now() - startTime,
          });
          conversationId = lkConversation?.id;

          await knowledgeRepo.incrementUsage(learnedKnowledge[0].id).catch(() => {});

          await createEscalation({
            roomId, userName: userName || 'unknown',
            message: combinedMessage, answer,
            confidence: learnedKnowledge[0].similarity,
            conversationId: lkConversation?.id,
            escalationType: 'soft',
            includeContext: false,
          });

          logger.info('Learned fallback response', {
            roomId, userName,
            similarity: learnedKnowledge[0].similarity,
            knowledgeId: learnedKnowledge[0].id,
            escCount: recentEscCount,
          });
        }
      }

      // 4a-3. 에스컬레이션 응답 (학습 폴백이 없었을 때)
      if (!answer) {
        answer = humanizer.humanizeResponse(getEscalationMessage(recentEscCount, roomId), { isThankYou: false });
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
      }
    } else {
      // 4b. 정상 응답 - 지식 컨텍스트에 신뢰도 표시
      const knowledgeContext = knowledge
        .map(k => {
          const sim = k.similarity ?? 0;
          const confidence = sim >= 0.8 ? '[정확도: 높음]' : sim >= 0.6 ? '[정확도: 보통]' : '[정확도: 낮음 - 참고만]';
          return `${confidence}\nQ: ${k.question}\nA: ${k.answer}`;
        })
        .join('\n\n');

      await loadChainOverrides();
      const useComplexModel = topSimilarity < 0.6;
      const strategy = aiGateway.resolveChainStrategy({
        complexity: useComplexModel ? 'complex' : 'simple',
        confidence: topSimilarity,
      });
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
          toneMirrorInstructions, learnedTone, customerToneForPrompt.honorific, customerProfile,
        );
        // similarity 0.6 미만 → gpt-4o (complex), 이상 → gpt-4o-mini (simple)
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

      // 캐시 저장 (soft-escalation은 짧은 TTL로 캐시)
      try {
        const cacheConfidence = isSoftEscalation ? Math.min(topSimilarity, 0.5) : topSimilarity;
        await getResponseCache().set(combinedMessage, answer, cacheConfidence, aiModel || 'unknown');
      } catch (e) {
        logger.warn('Cache set failed', { error: String(e) });
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

    // 7. 담당자 태그 + 개인톡 알림
    if (!isStaffSender && answer) {
      try {
        const staffCategory = await classifyCategory(combinedMessage);
        const { staffId: tagStaffId } = await resolveAssignee(roomId, staffCategory);
        if (tagStaffId) {
          const tagStaff = await dbQueryOne(
            'SELECT real_name, kakao_room_id FROM company_staff WHERE id = $1',
            [tagStaffId]
          );
          if (tagStaff?.real_name) {
            answer = `[담당: ${tagStaff.real_name}] ${answer}`;
          }
          // 에스컬레이션이 아닌 경우에만 별도 알림 (에스컬레이션은 createEscalation에서 이미 전송)
          if (!escalated && tagStaff?.kakao_room_id) {
            const msgPreview = combinedMessage.length > 100
              ? combinedMessage.substring(0, 100) + '...' : combinedMessage;
            await proactiveRepo.createMessage({
              room_id: tagStaff.kakao_room_id,
              user_name: tagStaff.real_name,
              message: `[새 문의 알림]\n톡방: ${roomId}\n고객: ${userName}\n문의: ${msgPreview}`,
              message_type: 'staff_notification',
            });
            logger.info('Staff notification sent', {
              staffId: tagStaffId, staffRoom: tagStaff.kakao_room_id,
            });
          }
        }
      } catch (e) {
        logger.warn('Staff tag failed', { error: String(e) });
      }
    }

    // 8. 응답 반환 (딜레이: 고객 메시지 읽기 + 응답 작성 시간 시뮬레이션)
    const baseDelay = humanizer.getResponseDelay();
    const readingTime = Math.min(combinedMessage.length * 50, 5000); // 고객 메시지 읽기 시간 (최대 5초)
    const typingTime = Math.min(answer.length * 30, 10000); // 응답 타이핑 시간 (최대 10초)
    const delay = Math.max(baseDelay, readingTime + typingTime);
    const customerMsgLength = (customerProfile?.avgMessageLength as 'short' | 'medium' | 'long') || undefined;
    const messages = humanizer.splitIntoMessages(answer, customerMsgLength);

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
