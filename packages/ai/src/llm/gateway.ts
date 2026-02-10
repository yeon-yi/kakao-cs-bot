import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getEnv } from '@kakao-cs-bot/config';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('ai:gateway');

export type TaskComplexity = 'simple' | 'complex';

export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** simple = GPT-4o mini, complex = GPT-4o (default: simple) */
  complexity?: TaskComplexity;
}

export interface LLMResponse {
  text: string;
  model: string;
  tokensUsed: { input: number; output: number };
  latencyMs: number;
  cost: number;
}

// 1M 토큰당 비용 (USD)
const COST_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
};

function estimateCost(model: string, input: number, output: number): number {
  const rate = COST_TABLE[model];
  if (!rate) return 0;
  return (input / 1_000_000) * rate.input + (output / 1_000_000) * rate.output;
}

class AIGateway {
  private gemini: GoogleGenerativeAI | null = null;
  private openai: OpenAI | null = null;

  private getGemini(): GoogleGenerativeAI | null {
    const key = getEnv().GEMINI_API_KEY;
    if (!key) return null;
    if (!this.gemini) this.gemini = new GoogleGenerativeAI(key);
    return this.gemini;
  }

  private getOpenAI(): OpenAI | null {
    const key = getEnv().OPENAI_API_KEY;
    if (!key) return null;
    if (!this.openai) this.openai = new OpenAI({ apiKey: key });
    return this.openai;
  }

  /**
   * 메인 생성 메서드
   *
   * 라우팅 전략:
   *   simple  → GPT-4o mini (인사, FAQ, 단순 질문)
   *   complex → GPT-4o      (분석, 상담, 역할 감지)
   *   실패 시 → Gemini Flash (백업)
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const complexity = request.complexity ?? 'simple';
    const start = Date.now();

    // 1순위: OpenAI (complexity에 따라 모델 선택)
    const openai = this.getOpenAI();
    if (openai) {
      try {
        return await this.callOpenAI(request, complexity, start);
      } catch (error) {
        logger.warn('OpenAI failed, trying Gemini fallback', { error: String(error), complexity });
      }
    }

    // 2순위: Gemini Flash (백업)
    const gemini = this.getGemini();
    if (gemini) {
      try {
        return await this.callGemini(request, start);
      } catch (error) {
        logger.error('Gemini fallback also failed', { error: String(error) });
      }
    }

    throw new Error('No AI provider available');
  }

  /**
   * 간편 메서드: 단순 질문용 (GPT-4o mini)
   */
  async generateSimple(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    return this.generate({ prompt, systemPrompt, complexity: 'simple' });
  }

  /**
   * 간편 메서드: 복잡한 질문용 (GPT-4o)
   */
  async generateComplex(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    return this.generate({ prompt, systemPrompt, complexity: 'complex' });
  }

  private async callOpenAI(request: LLMRequest, complexity: TaskComplexity, start: number): Promise<LLMResponse> {
    const openai = this.getOpenAI()!;
    const modelName = complexity === 'complex' ? 'gpt-4o' : 'gpt-4o-mini';

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.prompt });

    const response = await openai.chat.completions.create({
      model: modelName,
      messages,
      temperature: request.temperature ?? getEnv().AI_TEMPERATURE,
      max_tokens: request.maxTokens ?? getEnv().AI_MAX_TOKENS,
    });

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;

    logger.info('OpenAI response', {
      model: modelName,
      complexity,
      inputTokens,
      outputTokens,
      cost: estimateCost(modelName, inputTokens, outputTokens),
    });

    return {
      text: response.choices[0]?.message?.content ?? '',
      model: modelName,
      tokensUsed: { input: inputTokens, output: outputTokens },
      latencyMs: Date.now() - start,
      cost: estimateCost(modelName, inputTokens, outputTokens),
    };
  }

  private async callGemini(request: LLMRequest, start: number): Promise<LLMResponse> {
    const genAI = this.getGemini()!;
    const modelName = 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: request.temperature ?? getEnv().AI_TEMPERATURE,
        maxOutputTokens: request.maxTokens ?? getEnv().AI_MAX_TOKENS,
      },
    });

    const parts: string[] = [];
    if (request.systemPrompt) parts.push(request.systemPrompt);
    parts.push(request.prompt);

    const result = await model.generateContent(parts.join('\n\n'));
    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;

    logger.info('Gemini fallback response', {
      model: modelName,
      inputTokens,
      outputTokens,
    });

    return {
      text,
      model: modelName,
      tokensUsed: { input: inputTokens, output: outputTokens },
      latencyMs: Date.now() - start,
      cost: estimateCost(modelName, inputTokens, outputTokens),
    };
  }
}

export const aiGateway = new AIGateway();
