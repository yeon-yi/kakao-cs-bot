import Redis from 'ioredis';
import { createHash } from 'crypto';
import { getEnv } from '@kakao-cs-bot/config';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('ai:cache');

interface CachedResponse {
  answer: string;
  confidence: number;
  model: string;
  cachedAt: number;
}

export class AIResponseCache {
  private redis: Redis;
  private SHORT_TTL = 300;    // 5분 (정확한 매칭)
  private MEDIUM_TTL = 1800;  // 30분 (높은 신뢰도)
  private LONG_TTL = 86400;   // 24시간 (고신뢰 캐시)

  constructor() {
    this.redis = new Redis(getEnv().REDIS_URL);
  }

  private normalizeQuestion(question: string): string {
    return question.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?!.,;~]$/g, '');
  }

  private getCacheKey(question: string): string {
    const normalized = this.normalizeQuestion(question);
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `ai:response:${hash}`;
  }

  /** 텍스트 정규화 기반 캐시 조회 */
  async get(question: string): Promise<CachedResponse | null> {
    const key = this.getCacheKey(question);
    const cached = await this.redis.get(key);
    if (cached) {
      await this.redis.incr(`ai:cache:hits`);
      logger.debug('Cache hit (text)', { question: question.slice(0, 50) });
      try { return JSON.parse(cached); } catch { return null; }
    }
    await this.redis.incr(`ai:cache:misses`);
    return null;
  }

  /** 응답 캐시 저장 (신뢰도 기반 TTL) */
  async set(question: string, answer: string, confidence: number, model: string): Promise<void> {
    const key = this.getCacheKey(question);
    const ttl = confidence > 0.85 ? this.LONG_TTL
      : confidence > 0.7 ? this.MEDIUM_TTL
      : this.SHORT_TTL;
    const data: CachedResponse = { answer, confidence, model, cachedAt: Date.now() };
    await this.redis.setex(key, ttl, JSON.stringify(data));
  }

  /** 캐시 무효화 (지식 업데이트 시 호출) */
  async invalidateByPattern(pattern: string): Promise<number> {
    const keys = await this.redis.keys(`ai:response:*`);
    if (keys.length === 0) return 0;
    let deleted = 0;
    for (const key of keys.slice(0, 100)) {
      await this.redis.del(key);
      deleted++;
    }
    return deleted;
  }

  /** 전체 응답 캐시 무효화 (SCAN 기반, 지식 변경 시 사용) */
  async invalidateAll(): Promise<number> {
    let deleted = 0;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'ai:response:*', 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');
    if (deleted > 0) {
      logger.info(`Response cache invalidated: ${deleted} keys deleted`);
    }
    return deleted;
  }

  async getStats() {
    const [hits, misses] = await Promise.all([
      this.redis.get('ai:cache:hits'),
      this.redis.get('ai:cache:misses'),
    ]);
    const totalHits = parseInt(hits || '0');
    const totalMisses = parseInt(misses || '0');
    const total = totalHits + totalMisses;
    return {
      totalHits,
      totalMisses,
      total,
      hitRate: total > 0 ? totalHits / total : 0,
    };
  }

  async disconnect() {
    await this.redis.quit();
  }
}
