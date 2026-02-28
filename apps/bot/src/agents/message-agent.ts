import Redis from 'ioredis';
import { getEnv, createLogger } from '@kakao-cs-bot/config';
import { aiGateway, AIResponseCache, embedder, contextAnalyzer, humanizer } from '@kakao-cs-bot/ai';
import { KnowledgeRepository, ConversationRepository, EscalationRepository } from '@kakao-cs-bot/database';
import type { AgentMessage, MessageState, Task } from './types';

const ESCALATION_THRESHOLD = 0.5;

const logger = createLogger('bot:message-agent');

export class MessageAgent {
  private id: string;
  private redis: Redis;
  private pubsub: Redis;
  private cache: AIResponseCache;
  private knowledgeRepo: KnowledgeRepository;
  private conversationRepo: ConversationRepository;
  private escalationRepo: EscalationRepository;
  private currentState: MessageState = 'IDLE';
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(id: string) {
    this.id = id;
    const redisUrl = getEnv().REDIS_URL;
    this.redis = new Redis(redisUrl);
    this.pubsub = new Redis(redisUrl);
    this.cache = new AIResponseCache();
    this.knowledgeRepo = new KnowledgeRepository();
    this.conversationRepo = new ConversationRepository();
    this.escalationRepo = new EscalationRepository();
  }

  async start(): Promise<void> {
    // Register with coordinator
    await this.redis.hset(`agent:${this.id}:info`, {
      id: this.id,
      type: 'message',
      status: 'IDLE',
      startedAt: Date.now(),
    });

    // Subscribe for tasks
    await this.pubsub.subscribe('agent:message');
    this.pubsub.on('message', (_channel: string, message: string) => {
      this.handleTask(message).catch(err =>
        logger.error('Task handling failed', { error: String(err) })
      );
    });

    // Start heartbeat
    this.startHeartbeat();
    logger.info(`Message Agent ${this.id} started`);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      await this.redis.publish('agent:heartbeat', JSON.stringify({
        type: 'HEARTBEAT',
        from: this.id,
        payload: { status: this.currentState, timestamp: Date.now() },
      }));
    }, 5000);
  }

  private async handleTask(message: string): Promise<void> {
    const msg: AgentMessage = JSON.parse(message);
    if (msg.to !== this.id && msg.to !== 'broadcast') return;
    if (msg.type === 'TASK') {
      const task = msg.payload as Task;
      if (task.type === 'REPLY_ESCALATION') {
        await this.processEscalationReply(task);
      } else {
        await this.processMessage(task);
      }
    }
  }

  private async processMessage(task: Task): Promise<void> {
    const startTime = Date.now();
    const { roomId, userId, message, userName } = task.data;

    try {
      // 1. Reading
      this.currentState = 'READING';
      await this.simulateDelay(await humanizer.getReadingDelay(message.length));

      // 2. Analyzing context
      this.currentState = 'ANALYZING';
      const context = await contextAnalyzer.analyze({
        message,
        senderId: userId,
        senderRole: task.data.senderRole || 'UNKNOWN',
        roomId,
        history: task.data.history,
      });

      if (!context.shouldRespond) {
        await this.completeTask(task.id, { action: 'NO_RESPONSE', reason: context.reason });
        return;
      }

      // 3. Check cache
      const cached = await this.cache.get(message);
      if (cached) {
        this.currentState = 'TYPING';
        await this.simulateDelay(await humanizer.getTypingDelay(cached.answer.length));
        await this.completeTask(task.id, {
          action: 'RESPONDED',
          answer: cached.answer,
          fromCache: true,
          processingTime: Date.now() - startTime,
        });
        return;
      }

      // 4. Searching knowledge
      this.currentState = 'SEARCHING';
      const embedding = await embedder.embed(message);
      const knowledge = await this.knowledgeRepo.search(embedding, message, { limit: 5 });

      // 4.5 Check if escalation is needed (low similarity or no results)
      const topSimilarity = knowledge.length > 0 ? (knowledge[0].similarity ?? 0) : 0;
      const needsEscalation = knowledge.length === 0 || topSimilarity < ESCALATION_THRESHOLD;

      if (needsEscalation) {
        // Generate escalation response
        const escalationResponse = '확인 후 담당자가 안내드리겠습니다. 잠시만 기다려 주세요!';
        const humanizedEsc = humanizer.humanizeResponse(escalationResponse, { isThankYou: false });

        this.currentState = 'TYPING';
        await this.simulateDelay(await humanizer.getTypingDelay(humanizedEsc.length));

        // Save conversation
        const conversation = await this.conversationRepo.create({
          room_id: roomId,
          user_id: userId,
          user_name: userName,
          user_message: message,
          bot_response: humanizedEsc,
          context: { target: context.target, confidence: context.confidence },
          knowledge_tier: null,
          ai_model: null,
          confidence: context.confidence,
          response_time_ms: Date.now() - startTime,
        });

        // Classify category via AI
        const category = await this.classifyCategory(message);

        // Auto-assign if category assignee exists
        const assignee = await this.escalationRepo.getAssigneeByCategory(category).catch(() => null);

        // Create escalation record
        const escalation = await this.escalationRepo.create({
          conversation_id: conversation.id,
          room_id: roomId,
          user_id: userId,
          user_name: userName,
          user_message: message,
          bot_response: humanizedEsc,
          category,
          confidence: topSimilarity,
          status: assignee ? 'assigned' : 'pending',
          assigned_to: assignee ? (assignee as any).staff_id : null,
          assigned_at: assignee ? new Date().toISOString() : null,
        });

        // Publish escalation event for coordinator (Kakao mention)
        await this.redis.publish('escalation:created', JSON.stringify({
          escalationId: escalation.id,
          roomId,
          userName,
          message,
          category,
          assigneeName: assignee ? (assignee as any).company_staff?.kakao_name || (assignee as any).company_staff?.real_name : null,
        }));

        await this.completeTask(task.id, {
          action: 'ESCALATED',
          answer: humanizedEsc,
          escalationId: escalation.id,
          category,
          processingTime: Date.now() - startTime,
        });
        return;
      }

      // 5. Generating answer (knowledge found with sufficient similarity)
      this.currentState = 'GENERATING';
      const knowledgeContext = knowledge
        .map(k => `Q: ${k.question}\nA: ${k.answer}`)
        .join('\n\n');

      const systemPrompt = `당신은 광고 대행사의 CS 담당자입니다.
고객(광고주)의 질문에 친절하고 프로페셔널하게 답변합니다.

참고 지식:
${knowledgeContext || '(관련 지식 없음)'}

규칙:
- 정확한 정보만 제공하세요
- 모르는 것은 모른다고 하고, 담당자 확인 후 안내하겠다고 하세요
- 존댓말을 사용하세요
- 간결하게 답변하세요`;

      const response = await aiGateway.generate({
        prompt: message,
        systemPrompt,
        temperature: 0.2,
      });

      // 6. Humanize
      this.currentState = 'HUMANIZING';
      const isThankYou = /감사|고마|ㄱㅅ/.test(message);
      const humanized = humanizer.humanizeResponse(response.text, { isThankYou });

      // 7. Typing simulation
      this.currentState = 'TYPING';
      await this.simulateDelay(await humanizer.getTypingDelay(humanized.length));

      // 8. Cache the response
      await this.cache.set(message, humanized, 0.8, response.model);

      // 9. Save conversation
      await this.conversationRepo.create({
        room_id: roomId,
        user_id: userId,
        user_name: userName,
        user_message: message,
        bot_response: humanized,
        context: { target: context.target, confidence: context.confidence },
        knowledge_tier: knowledge.length > 0 ? knowledge[0].tier : null,
        ai_model: response.model,
        confidence: context.confidence,
        response_time_ms: Date.now() - startTime,
      });

      // 10. Complete
      await this.completeTask(task.id, {
        action: 'RESPONDED',
        answer: humanized,
        model: response.model,
        knowledgeTier: knowledge.length > 0 ? knowledge[0].tier : null,
        processingTime: Date.now() - startTime,
      });

    } catch (error) {
      logger.error('Message processing failed', { taskId: task.id, error: String(error) });
      await this.redis.publish('agent:result', JSON.stringify({
        type: 'ERROR',
        from: this.id,
        payload: { taskId: task.id, error: String(error) },
        timestamp: Date.now(),
      }));
    } finally {
      this.currentState = 'IDLE';
    }
  }

  private async classifyCategory(message: string): Promise<string> {
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
      const category = response.text.trim().replace(/["\n]/g, '');
      const validCategories = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];
      return validCategories.includes(category) ? category : '일반';
    } catch {
      return '일반';
    }
  }

  private async processEscalationReply(task: Task): Promise<void> {
    const { roomId, userName, question, answer } = task.data;
    try {
      this.currentState = 'GENERATING';
      const replyText = `${userName}님, 문의하신 내용에 대해 안내드립니다.\n\n${answer}`;

      this.currentState = 'HUMANIZING';
      const humanized = humanizer.humanizeResponse(replyText, { isThankYou: false });

      this.currentState = 'TYPING';
      await this.simulateDelay(await humanizer.getTypingDelay(humanized.length));

      await this.completeTask(task.id, {
        action: 'ESCALATION_REPLIED',
        answer: humanized,
        roomId,
        processingTime: Date.now() - task.createdAt,
      });
    } catch (error) {
      logger.error('Escalation reply failed', { taskId: task.id, error: String(error) });
      await this.redis.publish('agent:result', JSON.stringify({
        type: 'ERROR',
        from: this.id,
        payload: { taskId: task.id, error: String(error) },
        timestamp: Date.now(),
      }));
    } finally {
      this.currentState = 'IDLE';
    }
  }

  private async completeTask(taskId: string, result: any): Promise<void> {
    await this.redis.publish('agent:result', JSON.stringify({
      type: 'RESULT',
      from: this.id,
      payload: { taskId, result },
      timestamp: Date.now(),
    }));
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.min(ms, 5000)));
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    await this.cache.disconnect();
    await this.pubsub.quit();
    await this.redis.quit();
    logger.info(`Message Agent ${this.id} stopped`);
  }
}
