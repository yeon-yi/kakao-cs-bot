# 멀티 에이전트 구현 상세

## 에이전트 간 통신

### Message Bus (Redis Pub/Sub)
```typescript
// 채널 구조
channels:
  - agent:coordinator → 모든 에이전트
  - agent:message → Message Agent들
  - agent:knowledge → Knowledge Agent들
  - agent:learning → Learning Agent
  - agent:identity → Identity Agent

// 메시지 포맷
interface AgentMessage {
  id: string; // UUID
  type: 'TASK' | 'RESULT' | 'ERROR' | 'HEARTBEAT';
  from: string; // agent ID
  to: string | 'broadcast';
  payload: any;
  timestamp: number;
  correlationId?: string; // 요청-응답 매칭
}
```

## 1. Coordinator Agent

**파일**: `apps/bot/src/agents/coordinator.ts`
```typescript
import { Redis } from 'ioredis';
import { EventEmitter } from 'events';

interface Task {
  id: string;
  type: 'PROCESS_MESSAGE' | 'LEARN' | 'IDENTIFY';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  data: any;
  assignedTo?: string;
  status: 'PENDING' | 'ASSIGNED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: number;
  deadline?: number;
}

class CoordinatorAgent extends EventEmitter {
  private redis: Redis;
  private pubsub: Redis;
  private agents: Map<string, AgentInfo>;
  private tasks: Map<string, Task>;
  private healthCheckInterval: NodeJS.Timer;
  
  constructor() {
    super();
    this.redis = new Redis(process.env.REDIS_URL!);
    this.pubsub = new Redis(process.env.REDIS_URL!);
    this.agents = new Map();
    this.tasks = new Map();
  }
  
  async start(): Promise<void> {
    // 1. Pub/Sub 구독
    await this.pubsub.subscribe(
      'agent:coordinator',
      'agent:heartbeat',
      'agent:result'
    );
    
    this.pubsub.on('message', this.handleMessage.bind(this));
    
    // 2. 에이전트 디스커버리
    await this.discoverAgents();
    
    // 3. 헬스체크 시작
    this.startHealthCheck();
    
    // 4. 태스크 큐 처리
    this.startTaskProcessor();
    
    console.log('✅ Coordinator Agent started');
  }
  
  private async discoverAgents(): Promise<void> {
    // Redis에 등록된 모든 에이전트 찾기
    const keys = await this.redis.keys('agent:*:info');
    
    for (const key of keys) {
      const info = await this.redis.hgetall(key);
      this.agents.set(info.id, {
        id: info.id,
        type: info.type as AgentType,
        status: 'IDLE',
        lastHeartbeat: Date.now(),
        currentTask: null,
        metrics: {
          tasksCompleted: 0,
          avgProcessingTime: 0,
          errorRate: 0,
        }
      });
    }
    
    console.log(`📡 Discovered ${this.agents.size} agents`);
  }
  
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      const now = Date.now();
      
      for (const [id, agent] of this.agents) {
        // 30초 이상 heartbeat 없으면 비정상
        if (now - agent.lastHeartbeat > 30000) {
          console.warn(`⚠️ Agent unhealthy: ${id}`);
          agent.status = 'UNHEALTHY';
          
          // 진행 중인 태스크가 있으면 재할당
          if (agent.currentTask) {
            await this.reassignTask(agent.currentTask);
          }
          
          // 에이전트 재시작 시도
          await this.restartAgent(id);
        }
      }
    }, 10000); // 10초마다
  }
  
  async assignTask(task: Task): Promise<void> {
    // 1. 최적 에이전트 선택
    const agent = this.selectAgent(task.type);
    
    if (!agent) {
      console.error('❌ No available agent for task:', task.type);
      task.status = 'FAILED';
      return;
    }
    
    // 2. 태스크 할당
    task.assignedTo = agent.id;
    task.status = 'ASSIGNED';
    this.tasks.set(task.id, task);
    
    agent.status = 'BUSY';
    agent.currentTask = task.id;
    
    // 3. 에이전트에게 전달
    await this.redis.publish(`agent:${agent.type}`, JSON.stringify({
      type: 'TASK',
      from: 'coordinator',
      to: agent.id,
      payload: task,
      timestamp: Date.now(),
    }));
    
    console.log(`✅ Task ${task.id} assigned to ${agent.id}`);
  }
  
  private selectAgent(taskType: string): AgentInfo | null {
    // 로드 밸런싱 알고리즘
    const candidates = Array.from(this.agents.values())
      .filter(a => {
        // 태스크 타입에 맞는 에이전트
        if (taskType === 'PROCESS_MESSAGE' && a.type !== 'message') return false;
        if (taskType === 'LEARN' && a.type !== 'learning') return false;
        if (taskType === 'IDENTIFY' && a.type !== 'identity') return false;
        
        // 건강하고 IDLE 상태
        return a.status === 'IDLE' && a.lastHeartbeat > Date.now() - 30000;
      })
      .sort((a, b) => {
        // 성능이 좋은 에이전트 우선
        return a.metrics.avgProcessingTime - b.metrics.avgProcessingTime;
      });
    
    return candidates[0] || null;
  }
  
  private async handleMessage(channel: string, message: string): Promise<void> {
    const msg: AgentMessage = JSON.parse(message);
    
    switch (msg.type) {
      case 'HEARTBEAT':
        this.handleHeartbeat(msg);
        break;
      
      case 'RESULT':
        await this.handleTaskResult(msg);
        break;
      
      case 'ERROR':
        await this.handleTaskError(msg);
        break;
    }
  }
  
  private handleHeartbeat(msg: AgentMessage): void {
    const agent = this.agents.get(msg.from);
    if (agent) {
      agent.lastHeartbeat = Date.now();
      agent.status = msg.payload.status || 'IDLE';
    }
  }
  
  private async handleTaskResult(msg: AgentMessage): Promise<void> {
    const task = this.tasks.get(msg.payload.taskId);
    if (!task) return;
    
    task.status = 'COMPLETED';
    
    const agent = this.agents.get(msg.from);
    if (agent) {
      agent.status = 'IDLE';
      agent.currentTask = null;
      agent.metrics.tasksCompleted++;
      
      // 평균 처리 시간 업데이트
      const processingTime = Date.now() - task.createdAt;
      agent.metrics.avgProcessingTime = 
        (agent.metrics.avgProcessingTime * (agent.metrics.tasksCompleted - 1) + processingTime) 
        / agent.metrics.tasksCompleted;
    }
    
    this.emit('task:completed', task, msg.payload.result);
  }
  
  private async reassignTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    task.status = 'PENDING';
    task.assignedTo = undefined;
    
    await this.assignTask(task);
  }
  
  async stop(): Promise<void> {
    clearInterval(this.healthCheckInterval);
    await this.pubsub.quit();
    await this.redis.quit();
  }
}

export default CoordinatorAgent;
```

## 2. Message Agent

**파일**: `apps/bot/src/agents/message-agent.ts`
```typescript
import { Redis } from 'ioredis';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@api/server';

class MessageAgent {
  private id: string;
  private redis: Redis;
  private pubsub: Redis;
  private trpc: ReturnType<typeof createTRPCProxyClient<AppRouter>>;
  private currentState: MessageState;
  
  constructor(id: string) {
    this.id = id;
    this.redis = new Redis(process.env.REDIS_URL!);
    this.pubsub = new Redis(process.env.REDIS_URL!);
    
    this.trpc = createTRPCProxyClient<AppRouter>({
      links: [
        httpBatchLink({
          url: process.env.API_URL!,
        }),
      ],
    });
    
    this.currentState = 'IDLE';
  }
  
  async start(): Promise<void> {
    // 1. Coordinator에 등록
    await this.registerSelf();
    
    // 2. 태스크 구독
    await this.pubsub.subscribe('agent:message');
    this.pubsub.on('message', this.handleTask.bind(this));
    
    // 3. Heartbeat 시작
    this.startHeartbeat();
    
    console.log(`✅ Message Agent ${this.id} started`);
  }
  
  private async registerSelf(): Promise<void> {
    await this.redis.hset(`agent:${this.id}:info`, {
      id: this.id,
      type: 'message',
      status: 'IDLE',
      startedAt: Date.now(),
    });
  }
  
  private startHeartbeat(): void {
    setInterval(async () => {
      await this.redis.publish('agent:heartbeat', JSON.stringify({
        type: 'HEARTBEAT',
        from: this.id,
        payload: {
          status: this.currentState,
          timestamp: Date.now(),
        },
      }));
    }, 5000); // 5초마다
  }
  
  private async handleTask(channel: string, message: string): Promise<void> {
    const msg: AgentMessage = JSON.parse(message);
    
    // 내게 할당된 태스크가 아니면 무시
    if (msg.to !== this.id && msg.to !== 'broadcast') return;
    
    if (msg.type === 'TASK') {
      await this.processMessage(msg.payload);
    }
  }
  
  private async processMessage(task: Task): Promise<void> {
    const startTime = Date.now();
    
    try {
      const { roomId, userId, message } = task.data;
      
      // 1. 상태: READING
      this.currentState = 'READING';
      await this.simulateReading(message);
      
      // 2. 상태: ANALYZING
      this.currentState = 'ANALYZING';
      
      // 신원 확인
      const identity = await this.trpc.identity.identify.query({
        kakaoUserId: userId,
        kakaoName: task.data.userName,
        roomId,
      });
      
      // 맥락 분석
      const context = await this.trpc.context.analyze.query({
        message,
        senderId: userId,
        senderRole: identity.role,
        roomId,
        history: task.data.history,
      });
      
      // 개입하지 않아야 하면 종료
      if (!context.shouldRespond) {
        await this.completeTask(task.id, { 
          action: 'NO_RESPONSE', 
          reason: context.reason 
        });
        return;
      }
      
      // 3. 상태: SEARCHING
      this.currentState = 'SEARCHING';
      
      const knowledge = await this.trpc.knowledge.search.query({
        question: message,
        limit: 5,
      });
      
      // 4. 상태: GENERATING
      this.currentState = 'GENERATING';
      
      // AI 답변 생성 (AI Gateway 통해서)
      const answer = await this.generateAnswer(message, knowledge.results);
      
      // 5. 상태: HUMANIZING
      const humanized = await this.humanizeResponse(answer, context);
      
      // 6. 상태: TYPING
      this.currentState = 'TYPING';
      await this.simulateTyping(humanized);
      
      // 7. 상태: SENDING
      this.currentState = 'SENDING';
      await this.sendMessage(roomId, humanized);
      
      // 8. 학습
      await this.learnConversation(message, humanized, knowledge);
      
      // 9. 완료
      await this.completeTask(task.id, {
        action: 'RESPONDED',
        answer: humanized,
        processingTime: Date.now() - startTime,
      });
      
    } catch (error) {
      await this.handleError(task.id, error);
    } finally {
      this.currentState = 'IDLE';
    }
  }
  
  private async simulateReading(message: string): Promise<void> {
    // 사람처럼 읽기 시간
    const readTime = message.length * (Math.random() * 0.04 + 0.05); // 50-90ms per char
    await new Promise(resolve => setTimeout(resolve, readTime * 1000));
  }
  
  private async simulateTyping(message: string): Promise<void> {
    // 사람처럼 타이핑 시간
    const typeTime = message.length * (Math.random() * 0.05 + 0.08); // 80-130ms per char
    
    // 문장부호에서 일시정지
    const sentences = message.split(/[.!?]/);
    for (let i = 0; i < sentences.length; i++) {
      await new Promise(resolve => setTimeout(resolve, typeTime * 1000 / sentences.length));
      
      // 문장 사이 일시정지
      if (i < sentences.length - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 300));
      }
    }
  }
  
  private async generateAnswer(question: string, knowledgeResults: any[]): Promise<string> {
    // AI Gateway 호출 (LiteLLM)
    // 실제 구현은 packages/ai/src/llm/gateway.ts
    
    // Placeholder
    return "답변 내용";
  }
  
  private async humanizeResponse(answer: string, context: any): Promise<string> {
    // 프로페셔널한 톤으로 변환
    // human-touch/tone.ts 참조
    
    // 금지 요소 제거
    answer = answer.replace(/습니당|해용|~~/g, '');
    answer = answer.replace(/ㅋㅋ|ㅎㅎ|^^/g, '');
    
    // 문장 종결 다양화 (10% 확률)
    if (Math.random() < 0.1) {
      answer = answer.replace(/습니다/g, '해요');
    }
    
    // 매우 제한적 이모지 (하루 2회까지)
    const dailyEmojiCount = await this.getDailyEmojiCount();
    if (dailyEmojiCount < 2 && Math.random() < 0.2) {
      if (context.isThankYou) {
        answer += ' 🙏';
        await this.incrementDailyEmojiCount();
      }
    }
    
    return answer;
  }
  
  private async completeTask(taskId: string, result: any): Promise<void> {
    await this.redis.publish('agent:result', JSON.stringify({
      type: 'RESULT',
      from: this.id,
      payload: {
        taskId,
        result,
      },
      timestamp: Date.now(),
    }));
  }
}
```

## 3. Knowledge Agent

**파일**: `apps/bot/src/agents/knowledge-agent.ts`
```typescript
class KnowledgeAgent {
  private id: string;
  private supabase: SupabaseClient;
  private embedder: SentenceTransformer;
  
  async searchKnowledge(question: string, options: SearchOptions): Promise<SearchResult> {
    // 1. 임베딩 생성
    const embedding = await this.embedder.encode(question);
    
    // 2. Tier 1 검색 (공식 자료)
    const tier1 = await this.supabase.rpc('search_knowledge', {
      query_embedding: Array.from(embedding),
      query_text: question,
      p_tier: 1,
      p_limit: 5,
    });
    
    // Tier 1에서 충분히 좋은 결과가 있으면 종료
    if (tier1.data && tier1.data.length > 0 && tier1.data[0].similarity > 0.7) {
      return {
        tier: 1,
        results: tier1.data,
        status: 'FOUND',
      };
    }
    
    // 3. Tier 2 검색 (학습된 지식)
    const tier2 = await this.supabase.rpc('search_knowledge', {
      query_embedding: Array.from(embedding),
      query_text: question,
      p_tier: 2,
      p_limit: 5,
    });
    
    if (tier2.data && tier2.data.length > 0 && tier2.data[0].similarity > 0.6) {
      return {
        tier: 2,
        results: tier2.data,
        status: 'FOUND',
      };
    }
    
    // 4. Tier 3 검색 (대화 패턴)
    const tier3 = await this.supabase.rpc('search_knowledge', {
      query_embedding: Array.from(embedding),
      query_text: question,
      p_tier: 3,
      p_limit: 3,
    });
    
    if (tier3.data && tier3.data.length > 0 && tier3.data[0].similarity > 0.5) {
      return {
        tier: 3,
        results: tier3.data,
        status: 'UNCERTAIN',
      };
    }
    
    // 5. 결과 없음
    return {
      tier: 0,
      results: [],
      status: 'NOT_FOUND',
    };
  }
}
```