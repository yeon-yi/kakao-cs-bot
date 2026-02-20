import { getSupabaseAdmin } from '../client';
import type { Database } from '../types';

type KnowledgeRow = Database['public']['Tables']['knowledge_base']['Row'];
type KnowledgeInsert = Database['public']['Tables']['knowledge_base']['Insert'];

export class KnowledgeRepository {
  private get db() { return getSupabaseAdmin(); }

  async search(embedding: number[], text: string, options?: { tier?: number; category?: string; limit?: number }) {
    const { data, error } = await this.db.rpc('search_knowledge', {
      query_embedding: embedding as unknown as string,
      query_text: text,
      p_tier: options?.tier,
      p_category: options?.category,
      p_limit: options?.limit ?? 5,
    });
    if (error) throw error;
    return data ?? [];
  }

  async getById(id: string): Promise<KnowledgeRow | null> {
    const { data, error } = await this.db.from('knowledge_base').select('*').eq('id', id).single();
    if (error) return null;
    return data;
  }

  async add(input: KnowledgeInsert): Promise<KnowledgeRow> {
    const { data, error } = await this.db.from('knowledge_base').insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async update(id: string, updates: Partial<KnowledgeInsert>): Promise<KnowledgeRow> {
    const { data, error } = await this.db.from('knowledge_base').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db.from('knowledge_base').update({ is_active: false }).eq('id', id);
    if (error) throw error;
  }

  async incrementUsage(id: string): Promise<void> {
    await this.db.rpc('increment_usage_count', { knowledge_uuid: id });
  }

  async list(options?: { tier?: number; category?: string; offset?: number; limit?: number }) {
    let query = this.db.from('knowledge_base').select('*', { count: 'exact' }).eq('is_active', true);
    if (options?.tier) query = query.eq('tier', options.tier);
    if (options?.category) query = query.eq('category', options.category);
    query = query.order('updated_at', { ascending: false });
    if (options?.offset) query = query.range(options.offset, (options.offset) + (options?.limit ?? 20) - 1);
    else query = query.limit(options?.limit ?? 20);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }
}
