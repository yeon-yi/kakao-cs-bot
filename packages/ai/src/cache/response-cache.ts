import Redis from 'ioredis';
import { createHash } from 'crypto';
import { getEnv } from '@kakao-cs-bot/config';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('ai:cache');

export class AIResponseCache {
  private redis: Redis;
  private TTL = 86400; // 24 hours

  constructor() {
    this.redis = new Redis(getEnv().REDIS_URL);
  }

  private normalizeQuestion(question: string): string {
    return question.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?!.,;]$/g, '');
  }

  private getCacheKey(question: string): string {
    const normalized = this.normalizeQuestion(question);
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `ai:response:${hash}`;
  }

  async get(question: string): Promise<string | null> {
    const key = this.getCacheKey(question);
    const cached = await this.redis.get(key);
    if (cached) {
      await this.redis.incr(`${key}:hits`);
      logger.debug('Cache hit', { question: question.slice(0, 50) });
    }
    return cached;
  }

  async set(question: string, answer: string): Promise<void> {
    const key = this.getCacheKey(question);
    await this.redis.setex(key, this.TTL, answer);
  }

  async getStats() {
    const keys = await this.redis.keys('ai:response:*:hits');
    let totalHits = 0;
    for (const key of keys) {
      const hits = await this.redis.get(key);
      totalHits += parseInt(hits || '0');
    }
    return { totalQueries: keys.length, totalHits, hitRate: keys.length > 0 ? totalHits / keys.length : 0 };
  }

  async disconnect() {
    await this.redis.quit();
  }
}
