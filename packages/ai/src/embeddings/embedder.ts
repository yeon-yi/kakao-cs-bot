import OpenAI from 'openai';
import { getEnv } from '@kakao-cs-bot/config';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('ai:embeddings');

export class Embedder {
  private openai: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.openai) {
      const key = getEnv().OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY required for embeddings');
      this.openai = new OpenAI({ apiKey: key });
    }
    return this.openai;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const client = this.getClient();
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 768,
      });
      return response.data[0].embedding;
    } catch (error) {
      logger.error('Embedding failed', { error: String(error) });
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const client = this.getClient();
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
        dimensions: 768,
      });
      return response.data.map(d => d.embedding);
    } catch (error) {
      logger.error('Batch embedding failed', { error: String(error) });
      throw error;
    }
  }
}

export const embedder = new Embedder();
