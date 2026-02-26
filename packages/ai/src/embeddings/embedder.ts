import OpenAI from 'openai';
import { getEnv } from '@kakao-cs-bot/config';
import { createLogger } from '@kakao-cs-bot/config';
import Redis from 'ioredis';
import { createHash } from 'crypto';

const logger = createLogger('ai:embeddings');

export class Embedder {
  private openai: OpenAI | null = null;
  private redis: Redis | null = null;
  private CACHE_TTL = 86400; // 24시간

  private getClient(): OpenAI {
    if (!this.openai) {
      const key = getEnv().OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY required for embeddings');
      this.openai = new OpenAI({ apiKey: key });
    }
    return this.openai;
  }

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis(getEnv().REDIS_URL);
      this.redis.on('error', (err) => logger.warn('Embedder Redis error', { error: String(err) }));
    }
    return this.redis;
  }

  private normalizeText(text: string): string {
    return text.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private getCacheKey(text: string): string {
    const normalized = this.normalizeText(text);
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `emb:${hash}`;
  }

  async embed(text: string): Promise<number[]> {
    // 1. Redis 캐시 조회
    try {
      const cacheKey = this.getCacheKey(text);
      const cached = await this.getRedis().get(cacheKey);
      if (cached) {
        logger.debug('Embedding cache hit', { text: text.slice(0, 40) });
        return JSON.parse(cached);
      }
    } catch (e) {
      logger.warn('Embedding cache read failed', { error: String(e) });
    }

    // 2. OpenAI API 호출
    try {
      const client = this.getClient();
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 768,
      });
      const embedding = response.data[0].embedding;

      // 3. Redis 캐시 저장 (비동기)
      try {
        const cacheKey = this.getCacheKey(text);
        await this.getRedis().setex(cacheKey, this.CACHE_TTL, JSON.stringify(embedding));
      } catch {}

      return embedding;
    } catch (error) {
      logger.error('Embedding failed', { error: String(error) });
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // 개별 캐시 확인 후 미스만 API 호출
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const missIndices: number[] = [];
    const missTexts: string[] = [];

    try {
      for (let i = 0; i < texts.length; i++) {
        const cacheKey = this.getCacheKey(texts[i]);
        const cached = await this.getRedis().get(cacheKey);
        if (cached) {
          results[i] = JSON.parse(cached);
        } else {
          missIndices.push(i);
          missTexts.push(texts[i]);
        }
      }
    } catch {
      // 캐시 실패 시 전부 API 호출
      for (let i = 0; i < texts.length; i++) {
        if (!results[i]) {
          missIndices.push(i);
          missTexts.push(texts[i]);
        }
      }
    }

    if (missTexts.length > 0) {
      try {
        const client = this.getClient();
        const response = await client.embeddings.create({
          model: 'text-embedding-3-small',
          input: missTexts,
          dimensions: 768,
        });
        for (let j = 0; j < response.data.length; j++) {
          const idx = missIndices[j];
          results[idx] = response.data[j].embedding;
          // 캐시 저장
          try {
            const cacheKey = this.getCacheKey(missTexts[j]);
            await this.getRedis().setex(cacheKey, this.CACHE_TTL, JSON.stringify(response.data[j].embedding));
          } catch {}
        }
      } catch (error) {
        logger.error('Batch embedding failed', { error: String(error) });
        throw error;
      }
    }

    return results as number[][];
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {});
      this.redis = null;
    }
  }
}

export const embedder = new Embedder();
