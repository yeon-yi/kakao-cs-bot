import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { getEnv, createLogger } from '@kakao-cs-bot/config';
import type { AgentMessage, AgentInfo, Task, AgentType } from './types';

const logger = createLogger('bot:coordinator');

export class CoordinatorAgent extends EventEmitter {
  private redis: Redis;
  private pubsub: Redis;
  private agents: Map<string, AgentInfo> = new Map();
  private tasks: Map<string, Task> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    const redisUrl = getEnv().REDIS_URL;
    this.redis = new Redis(redisUrl);
    this.pubsub = new Redis(redisUrl);
  }

  async start(): Promise<void> {
    // Subscribe to channels
    await this.pubsub.subscribe('agent:coordinator', 'agent:heartbeat', 'agent:result', 'escalation:answered');
    this.pubsub.on('message', (channel: string, message: string) => {
      if (channel === 'escalation:answered') {
        this.handleEscalationAnswer(message).catch(err =>
          logger.error('Escalation answer handling failed', { error: String(err) })
        );
        return;
      }
      this.handleMessage(channel, message).catch(err =>
        logger.error('Message handling failed', { error: String(err) })
      );
    });

    // Discover existing agents
    await this.discoverAgents();

    // Start health check
    this.startHealthCheck();

    logger.info('Coordinator started');
  }

  private async discoverAgents(): Promise<void> {
    const keys = await this.redis.keys('agent:*:info');
    for (const key of keys) {
      const info = await this.redis.hgetall(key);
      if (info.id) {
        this.agents.set(info.id, {
          id: info.id,
          type: info.type as AgentType,
          status: 'IDLE',
          lastHeartbeat: Date.now(),
          currentTask: null,
          metrics: { tasksCompleted: 0, avgProcessingTime: 0, errorRate: 0 },
        });
      }
    }
    logger.info(`Discovered ${this.agents.size} agents`);
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, agent] of this.agents) {
        if (now - agent.lastHeartbeat > 30000) {
          logger.warn(`Agent unhealthy: ${id}`);
          agent.status = 'UNHEALTHY';

          if (agent.currentTask) {
            this.reassignTask(agent.currentTask).catch(() => {});
          }
        }
      }
    }, 10000);
  }

  async assignTask(task: Task): Promise<void> {
    const agent = this.selectAgent(task.type);
    if (!agent) {
      logger.error('No available agent for task', { type: task.type });
      task.status = 'FAILED';
      return;
    }

    task.assignedTo = agent.id;
    task.status = 'ASSIGNED';
    this.tasks.set(task.id, task);

    agent.status = 'BUSY';
    agent.currentTask = task.id;

    await this.redis.publish(`agent:${agent.type}`, JSON.stringify({
      type: 'TASK',
      from: 'coordinator',
      to: agent.id,
      payload: task,
      timestamp: Date.now(),
    }));

    logger.info(`Task ${task.id} assigned to ${agent.id}`);
  }

  private async handleEscalationAnswer(message: string): Promise<void> {
    const data = JSON.parse(message);
    const { escalationId, roomId, userName, question, answer } = data;
    const taskId = `escalation-reply-${escalationId}-${Date.now()}`;
    const task: Task = {
      id: taskId,
      type: 'REPLY_ESCALATION',
      priority: 'HIGH',
      data: { roomId, userName, question, answer, escalationId },
      status: 'PENDING',
      createdAt: Date.now(),
    };
    await this.assignTask(task);
    logger.info(`Escalation reply task created`, { escalationId, taskId });
  }

  private selectAgent(taskType: string): AgentInfo | null {
    const typeMap: Record<string, AgentType> = {
      PROCESS_MESSAGE: 'message',
      REPLY_ESCALATION: 'message',
      LEARN: 'learning',
      IDENTIFY: 'identity',
    };
    const targetType = typeMap[taskType] || 'message';

    const candidates = Array.from(this.agents.values())
      .filter(a => a.type === targetType && a.status === 'IDLE' && a.lastHeartbeat > Date.now() - 30000)
      .sort((a, b) => a.metrics.avgProcessingTime - b.metrics.avgProcessingTime);

    return candidates[0] || null;
  }

  private async handleMessage(_channel: string, message: string): Promise<void> {
    const msg: AgentMessage = JSON.parse(message);
    switch (msg.type) {
      case 'HEARTBEAT':
        this.handleHeartbeat(msg);
        break;
      case 'RESULT':
        this.handleTaskResult(msg);
        break;
      case 'ERROR':
        this.handleTaskError(msg);
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

  private handleTaskResult(msg: AgentMessage): void {
    const task = this.tasks.get(msg.payload.taskId);
    if (!task) return;

    task.status = 'COMPLETED';
    const agent = this.agents.get(msg.from);
    if (agent) {
      agent.status = 'IDLE';
      agent.currentTask = null;
      agent.metrics.tasksCompleted++;
      const pt = Date.now() - task.createdAt;
      agent.metrics.avgProcessingTime =
        (agent.metrics.avgProcessingTime * (agent.metrics.tasksCompleted - 1) + pt) / agent.metrics.tasksCompleted;
    }
    this.emit('task:completed', task, msg.payload.result);
  }

  private handleTaskError(msg: AgentMessage): void {
    const task = this.tasks.get(msg.payload.taskId);
    if (task) {
      task.status = 'FAILED';
      logger.error('Task failed', { taskId: task.id, error: msg.payload.error });
    }
  }

  private async reassignTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'PENDING';
    task.assignedTo = undefined;
    await this.assignTask(task);
  }

  async stop(): Promise<void> {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    await this.pubsub.quit();
    await this.redis.quit();
    logger.info('Coordinator stopped');
  }
}
