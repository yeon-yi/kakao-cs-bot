import { aiGateway } from '../llm/gateway';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('ai:context');

export interface ContextInput {
  message: string;
  senderId: string;
  senderRole: 'ADVERTISER' | 'STAFF' | 'UNKNOWN';
  roomId: string;
  history?: Array<{ senderId: string; message: string; timestamp: number }>;
  hasMention?: boolean;
  mentionTarget?: string;
}

export interface ContextResult {
  shouldRespond: boolean;
  confidence: number;
  reason: string;
  target: 'TO_COMPANY' | 'TO_STAFF' | 'TO_ADVERTISER' | 'CHITCHAT' | 'STAFF_QUESTION';
  processingTime: number;
}

export class ContextAnalyzer {
  async analyze(input: ContextInput): Promise<ContextResult> {
    const start = Date.now();

    // Quick filters
    if (input.senderRole === 'STAFF') {
      return this.analyzeStaffMessage(input, start);
    }

    // For advertisers and unknown users, use AI analysis
    const systemPrompt = `당신은 카카오톡 채팅방 맥락 분석기입니다.
광고 대행사 업무 채팅방에서 메시지를 분석하여 봇이 개입해야 하는지 판단합니다.

규칙:
1. 광고주가 회사에 질문하면 -> shouldRespond: true
2. 직원이 광고주에게 답변 중이면 -> shouldRespond: false
3. 직원 간 대화면 -> shouldRespond: false
4. 잡담이면 -> shouldRespond: false
5. 확신도 0.6 미만이면 -> shouldRespond: false

JSON으로만 응답하세요: {"shouldRespond": boolean, "confidence": number, "reason": string, "target": string}`;

    try {
      const historyText = (input.history || [])
        .slice(-5)
        .map(h => `[${h.senderId}]: ${h.message}`)
        .join('\n');

      const prompt = `발화자: ${input.senderId} (역할: ${input.senderRole})
방: ${input.roomId}
메시지: "${input.message}"
최근 대화:
${historyText}

이 메시지에 봇이 응답해야 하는지 분석하세요.`;

      const response = await aiGateway.generate({ prompt, systemPrompt, temperature: 0.1, complexity: 'simple' });
      const parsed = JSON.parse(response.text);

      return {
        shouldRespond: parsed.shouldRespond && parsed.confidence >= 0.6,
        confidence: parsed.confidence,
        reason: parsed.reason,
        target: parsed.target || 'TO_COMPANY',
        processingTime: Date.now() - start,
      };
    } catch (error) {
      logger.warn('Context analysis failed, defaulting to no response', { error: String(error) });
      return {
        shouldRespond: false,
        confidence: 0,
        reason: 'Analysis failed - safe mode',
        target: 'TO_COMPANY',
        processingTime: Date.now() - start,
      };
    }
  }

  private async analyzeStaffMessage(input: ContextInput, start: number): Promise<ContextResult> {
    // Staff messages: check if asking the company (system) a question
    const staffPatterns = {
      toAdvertiser: /님|씨|고객님|광고주님|드립니다|해드립니다|부탁드립니다/,
      systemQuestion: /시스템|프로그램|어디|어떻게.*하나요|방법/,
    };

    if (staffPatterns.toAdvertiser.test(input.message)) {
      return {
        shouldRespond: false,
        confidence: 0.85,
        reason: 'Staff speaking to advertiser',
        target: 'TO_ADVERTISER',
        processingTime: Date.now() - start,
      };
    }

    if (staffPatterns.systemQuestion.test(input.message)) {
      return {
        shouldRespond: true,
        confidence: 0.7,
        reason: 'Staff asking system question',
        target: 'STAFF_QUESTION',
        processingTime: Date.now() - start,
      };
    }

    return {
      shouldRespond: false,
      confidence: 0.6,
      reason: 'Staff message - no intervention needed',
      target: 'TO_STAFF',
      processingTime: Date.now() - start,
    };
  }
}

export const contextAnalyzer = new ContextAnalyzer();
