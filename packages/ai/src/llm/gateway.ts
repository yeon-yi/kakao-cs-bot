import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getEnv } from '@kakao-cs-bot/config';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('ai:gateway');

export type TaskComplexity = 'simple' | 'complex';
export type ProviderName = 'openai' | 'gemini' | 'anthropic';
export type ChainMode = 'single' | '2-chain' | '3-chain';
export type ChainRole = 'analyzer' | 'responder' | 'verifier';

export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  complexity?: TaskComplexity;
  /** 특정 프로바이더 강제 지정 */
  provider?: ProviderName;
  /** 이미지 URL (비전 모델용, 미래 대비) */
  imageUrl?: string;
  /** JSON 모드 (OpenAI response_format: json_object) */
  jsonMode?: boolean;
}

export interface LLMResponse {
  text: string;
  model: string;
  tokensUsed: { input: number; output: number };
  latencyMs: number;
  cost: number;
}

export interface ChainStepResult {
  role: ChainRole;
  model: string;
  provider: ProviderName;
  tokensUsed: { input: number; output: number };
  cost: number;
  latencyMs: number;
  output: string;
}

export interface ChainResult {
  finalText: string;
  steps: ChainStepResult[];
  totalCost: number;
  totalLatencyMs: number;
  mode: ChainMode;
}

interface ChainStepConfig {
  role: ChainRole;
  provider: ProviderName;
  temperature: number;
}

interface ChainStrategy {
  mode: ChainMode;
  steps: ChainStepConfig[];
}

// 1M 토큰당 비용 (USD)
const COST_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
};

function estimateCost(model: string, input: number, output: number): number {
  const rate = COST_TABLE[model];
  if (!rate) return 0;
  return (input / 1_000_000) * rate.input + (output / 1_000_000) * rate.output;
}

class AIGateway {
  private gemini: GoogleGenerativeAI | null = null;
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;

  // 체인 전략 캐시 (5분)
  private cachedStrategy: { strategy: ChainStrategy; loadedAt: number } | null = null;
  private readonly STRATEGY_CACHE_TTL = 300_000;

  // 수동 설정 오버라이드 (외부에서 주입)
  private manualOverrides: {
    chainMode?: string;
    analyzer?: string;
    responder?: string;
    verifier?: string;
  } = {};

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

  private getAnthropic(): Anthropic | null {
    const key = getEnv().ANTHROPIC_API_KEY;
    if (!key) return null;
    if (!this.anthropic) this.anthropic = new Anthropic({ apiKey: key });
    return this.anthropic;
  }

  /** 사용 가능한 프로바이더 목록 */
  getAvailableProviders(): ProviderName[] {
    const providers: ProviderName[] = [];
    if (this.getOpenAI()) providers.push('openai');
    if (this.getGemini()) providers.push('gemini');
    if (this.getAnthropic()) providers.push('anthropic');
    return providers;
  }

  /** 수동 설정 오버라이드 업데이트 (webhook에서 호출) */
  setManualOverrides(overrides: typeof this.manualOverrides) {
    this.manualOverrides = overrides;
    this.cachedStrategy = null; // 캐시 무효화
  }

  /**
   * API 키 보유 상태에 따라 자동으로 최적 체인 전략 결정
   *
   * 3키 → Gemini분석 → GPT응답 → Claude검증
   * 2키 → 2-chain (조합에 따라 역할 자동 배정)
   * 1키 → single (단독)
   */
  resolveChainStrategy(): ChainStrategy {
    const now = Date.now();
    if (this.cachedStrategy && now - this.cachedStrategy.loadedAt < this.STRATEGY_CACHE_TTL) {
      return this.cachedStrategy.strategy;
    }

    const available = this.getAvailableProviders();
    const override = this.manualOverrides;
    let strategy: ChainStrategy;

    // 수동 모드 지정 시
    if (override.chainMode && override.chainMode !== 'auto') {
      strategy = this.buildManualStrategy(override.chainMode as ChainMode, available);
    } else {
      // 자동 결정
      strategy = this.buildAutoStrategy(available);
    }

    // 개별 역할 수동 오버라이드 적용
    for (const step of strategy.steps) {
      const manualProvider = override[step.role] as string | undefined;
      if (manualProvider && manualProvider !== 'auto' && available.includes(manualProvider as ProviderName)) {
        step.provider = manualProvider as ProviderName;
      }
    }

    this.cachedStrategy = { strategy, loadedAt: now };
    logger.info('Chain strategy resolved', {
      mode: strategy.mode,
      steps: strategy.steps.map(s => `${s.role}:${s.provider}`),
      available,
      overrides: override,
    });
    return strategy;
  }

  private buildAutoStrategy(available: ProviderName[]): ChainStrategy {
    const has = (p: ProviderName) => available.includes(p);

    // 3키: 풀 체인
    if (has('openai') && has('gemini') && has('anthropic')) {
      return {
        mode: '3-chain',
        steps: [
          { role: 'analyzer', provider: 'gemini', temperature: 0.3 },
          { role: 'responder', provider: 'openai', temperature: 0.5 },
          { role: 'verifier', provider: 'anthropic', temperature: 0.2 },
        ],
      };
    }

    // 2키 조합
    if (has('openai') && has('gemini')) {
      return {
        mode: '2-chain',
        steps: [
          { role: 'analyzer', provider: 'gemini', temperature: 0.3 },
          { role: 'responder', provider: 'openai', temperature: 0.5 },
        ],
      };
    }
    if (has('openai') && has('anthropic')) {
      return {
        mode: '2-chain',
        steps: [
          { role: 'analyzer', provider: 'openai', temperature: 0.3 },
          { role: 'verifier', provider: 'anthropic', temperature: 0.3 },
        ],
      };
    }
    if (has('gemini') && has('anthropic')) {
      return {
        mode: '2-chain',
        steps: [
          { role: 'analyzer', provider: 'gemini', temperature: 0.3 },
          { role: 'responder', provider: 'anthropic', temperature: 0.5 },
        ],
      };
    }

    // 1키: 단독
    return {
      mode: 'single',
      steps: [{ role: 'responder', provider: available[0] || 'openai', temperature: 0.5 }],
    };
  }

  private buildManualStrategy(mode: ChainMode, available: ProviderName[]): ChainStrategy {
    if (mode === 'single' || available.length < 2) {
      return {
        mode: 'single',
        steps: [{ role: 'responder', provider: available[0] || 'openai', temperature: 0.5 }],
      };
    }
    // 수동 모드지만 자동 배정으로 기본 구성
    const auto = this.buildAutoStrategy(available);
    if (mode === '2-chain' && auto.steps.length > 2) {
      return { mode: '2-chain', steps: auto.steps.slice(0, 2) };
    }
    if (mode === '3-chain' && available.length >= 3) {
      return auto; // 이미 3-chain
    }
    return auto;
  }

  // ─── 메인 생성 메서드 ───────────────────────────────

  /**
   * 단일 모델 생성 (기존 호환 + provider 지정 지원)
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();

    // provider 지정 시 해당 모델만 사용
    if (request.provider) {
      return this.callProvider(request.provider, request, start);
    }

    const complexity = request.complexity ?? 'simple';

    // 1순위: OpenAI
    const openai = this.getOpenAI();
    if (openai) {
      try {
        return await this.callOpenAI(request, complexity, start);
      } catch (error) {
        logger.warn('OpenAI failed, trying fallback', { error: String(error) });
      }
    }

    // 2순위: Gemini
    const gemini = this.getGemini();
    if (gemini) {
      try {
        return await this.callGemini(request, start);
      } catch (error) {
        logger.warn('Gemini failed, trying Anthropic', { error: String(error) });
      }
    }

    // 3순위: Anthropic
    const anthropic = this.getAnthropic();
    if (anthropic) {
      try {
        return await this.callAnthropic(request, start);
      } catch (error) {
        logger.error('All providers failed', { error: String(error) });
      }
    }

    throw new Error('No AI provider available');
  }

  async generateSimple(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    return this.generate({ prompt, systemPrompt, complexity: 'simple' });
  }

  async generateComplex(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    return this.generate({ prompt, systemPrompt, complexity: 'complex' });
  }

  // ─── 멀티모델 체인 생성 ─────────────────────────────

  /**
   * 멀티모델 체인 실행
   * 자동으로 API 키 기반 전략 결정 후 단계별 실행
   */
  async generateChain(
    userMessage: string,
    knowledgeContext: string,
    historyContext: string,
  ): Promise<ChainResult> {
    const strategy = this.resolveChainStrategy();
    const totalStart = Date.now();
    const steps: ChainStepResult[] = [];

    if (strategy.mode === 'single') {
      // 단일 모드: 기존 generate 사용
      const step = strategy.steps[0];
      const resp = await this.callProvider(step.provider, {
        prompt: userMessage,
        systemPrompt: this.buildResponderPrompt(knowledgeContext, historyContext),
        temperature: step.temperature,
      }, totalStart);
      steps.push({
        role: 'responder', model: resp.model, provider: step.provider,
        tokensUsed: resp.tokensUsed, cost: resp.cost, latencyMs: resp.latencyMs, output: resp.text,
      });
      return { finalText: resp.text, steps, totalCost: resp.cost, totalLatencyMs: resp.latencyMs, mode: 'single' };
    }

    // ─── Step 1: Analyzer ───
    const analyzerStep = strategy.steps.find(s => s.role === 'analyzer');
    let analysisText = '';
    if (analyzerStep) {
      const resp = await this.callProvider(analyzerStep.provider, {
        prompt: this.buildAnalyzerPrompt(userMessage, knowledgeContext, historyContext),
        systemPrompt: '고객 메시지 분석 전문가입니다. 지시된 형식으로만 응답하세요.',
        temperature: analyzerStep.temperature,
        maxTokens: 500,
      }, Date.now());
      analysisText = resp.text;
      steps.push({
        role: 'analyzer', model: resp.model, provider: analyzerStep.provider,
        tokensUsed: resp.tokensUsed, cost: resp.cost, latencyMs: resp.latencyMs, output: resp.text,
      });
    }

    // ─── Step 2: Responder ───
    const responderStep = strategy.steps.find(s => s.role === 'responder');
    let responseText = '';
    if (responderStep) {
      const prompt = analysisText
        ? `고객 메시지: "${userMessage}"\n\n분석 결과:\n${analysisText}\n\n참고 지식:\n${knowledgeContext}\n\n최근 대화:\n${historyContext || '(첫 대화)'}\n\n위 분석을 바탕으로 고객에게 최적의 답변을 작성하세요.`
        : userMessage;
      const resp = await this.callProvider(responderStep.provider, {
        prompt,
        systemPrompt: this.buildResponderPrompt(knowledgeContext, analysisText ? '' : historyContext),
        temperature: responderStep.temperature,
      }, Date.now());
      responseText = resp.text;
      steps.push({
        role: 'responder', model: resp.model, provider: responderStep.provider,
        tokensUsed: resp.tokensUsed, cost: resp.cost, latencyMs: resp.latencyMs, output: resp.text,
      });
    }

    // ─── Step 3: Verifier (3-chain only) ───
    const verifierStep = strategy.steps.find(s => s.role === 'verifier');
    let finalText = responseText;
    if (verifierStep) {
      const resp = await this.callProvider(verifierStep.provider, {
        prompt: `원래 고객 질문: "${userMessage}"\n\n제안된 답변:\n"${responseText}"\n\n참고 지식:\n${knowledgeContext}\n\n검증하세요:\n1. 지식과 일치하는가?\n2. 고객 톤에 적절한가?\n3. 누락 정보 없는가?\n\n수정 필요하면 수정된 답변을, 아니면 그대로 출력하세요. 검증 메모 없이 최종 답변만 출력:`,
        systemPrompt: '답변 품질 검증기입니다. 최종 답변만 출력하세요.',
        temperature: verifierStep.temperature,
        maxTokens: 1500,
      }, Date.now());
      finalText = resp.text;
      steps.push({
        role: 'verifier', model: resp.model, provider: verifierStep.provider,
        tokensUsed: resp.tokensUsed, cost: resp.cost, latencyMs: resp.latencyMs, output: resp.text,
      });
    }

    // 2-chain에서 verifier 없이 responder 결과가 최종
    if (!verifierStep && !finalText) finalText = responseText;

    const totalCost = steps.reduce((s, st) => s + st.cost, 0);
    return {
      finalText: finalText || responseText || analysisText,
      steps,
      totalCost,
      totalLatencyMs: Date.now() - totalStart,
      mode: strategy.mode,
    };
  }

  // ─── 프롬프트 빌더 ──────────────────────────────────

  private buildAnalyzerPrompt(userMessage: string, knowledge: string, history: string): string {
    return `다음 고객 메시지를 분석하세요:
메시지: "${userMessage}"

참고 지식:
${knowledge || '(없음)'}

최근 대화:
${history || '(첫 대화)'}

다음을 분석:
1. 질문 복잡도 (단순/보통/복잡)
2. 핵심 키워드
3. 고객 감정 (긍정/중립/부정/급함)
4. 추천 응답 방향 (2~3줄)
5. 가장 관련 있는 지식 내용 요약`;
  }

  private buildResponderPrompt(knowledge: string, history: string): string {
    return `당신은 온라인 마케팅/광고 대행사의 CS 담당 직원입니다.
카카오톡으로 광고주(고객)와 대화합니다. 고객은 대부분 사업주/대표입니다.

대화 스타일:
- 고객을 "대표님"으로 호칭
- 프로페셔널한 존댓말, 2~4문장 이내
- 확신 있는 정보만 전달
- AI임을 절대 드러내지 마세요

${knowledge ? `참고 지식:\n${knowledge}` : ''}
${history ? `최근 대화:\n${history}` : ''}`;
  }

  // ─── 프로바이더별 호출 ──────────────────────────────

  private async callProvider(provider: ProviderName, request: LLMRequest, start: number): Promise<LLMResponse> {
    switch (provider) {
      case 'openai': return this.callOpenAI(request, request.complexity ?? 'complex', start);
      case 'gemini': return this.callGemini(request, start);
      case 'anthropic': return this.callAnthropic(request, start);
      default: throw new Error(`Unknown provider: ${provider}`);
    }
  }

  private async callOpenAI(request: LLMRequest, complexity: TaskComplexity, start: number): Promise<LLMResponse> {
    const openai = this.getOpenAI()!;
    const modelName = 'gpt-4o';

    const messages: Array<{ role: 'system' | 'user'; content: any }> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });

    // 비전 지원: imageUrl이 있으면 멀티모달 content
    if (request.imageUrl) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: request.prompt },
          { type: 'image_url', image_url: { url: request.imageUrl } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: request.prompt });
    }

    const createParams: any = {
      model: request.imageUrl ? 'gpt-4o' : modelName, // 비전은 gpt-4o 필수
      messages,
      temperature: request.temperature ?? getEnv().AI_TEMPERATURE,
      max_tokens: request.maxTokens ?? getEnv().AI_MAX_TOKENS,
    };

    // JSON 모드: 구조화된 응답 보장
    if (request.jsonMode) {
      createParams.response_format = { type: 'json_object' };
    }

    const response = await openai.chat.completions.create(createParams);

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const usedModel = request.imageUrl ? 'gpt-4o' : modelName;

    logger.info('OpenAI response', { model: usedModel, inputTokens, outputTokens });

    return {
      text: response.choices[0]?.message?.content ?? '',
      model: usedModel,
      tokensUsed: { input: inputTokens, output: outputTokens },
      latencyMs: Date.now() - start,
      cost: estimateCost(usedModel, inputTokens, outputTokens),
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

    // 비전 지원: imageUrl이 있으면 인라인 이미지 포함
    let parts: any[];
    if (request.imageUrl) {
      try {
        const imgResp = await fetch(request.imageUrl);
        const imgBuf = Buffer.from(await imgResp.arrayBuffer());
        const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
        parts = [
          request.systemPrompt ? request.systemPrompt + '\n\n' : '',
          request.prompt,
          { inlineData: { data: imgBuf.toString('base64'), mimeType } },
        ].filter(Boolean);
      } catch {
        // 이미지 로드 실패 시 텍스트만
        parts = [];
        if (request.systemPrompt) parts.push(request.systemPrompt);
        parts.push(request.prompt);
      }
    } else {
      parts = [];
      if (request.systemPrompt) parts.push(request.systemPrompt);
      parts.push(request.prompt);
    }

    const result = await model.generateContent(
      Array.isArray(parts) && parts.some(p => typeof p !== 'string')
        ? parts
        : (parts as string[]).join('\n\n')
    );
    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;

    logger.info('Gemini response', { model: modelName, inputTokens, outputTokens });

    return {
      text,
      model: modelName,
      tokensUsed: { input: inputTokens, output: outputTokens },
      latencyMs: Date.now() - start,
      cost: estimateCost(modelName, inputTokens, outputTokens),
    };
  }

  private async callAnthropic(request: LLMRequest, start: number): Promise<LLMResponse> {
    const anthropic = this.getAnthropic()!;
    const modelName = 'claude-sonnet-4-20250514';

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: request.prompt },
    ];

    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: request.maxTokens ?? getEnv().AI_MAX_TOKENS ?? 2048,
      temperature: request.temperature ?? getEnv().AI_TEMPERATURE ?? 0.7,
      system: request.systemPrompt || undefined,
      messages,
    });

    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map(c => c.text)
      .join('');
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    logger.info('Anthropic response', { model: modelName, inputTokens, outputTokens });

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
