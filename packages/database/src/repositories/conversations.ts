import { getSupabaseAdmin } from '../client';
import type { Database } from '../types';

type ConversationInsert = Database['public']['Tables']['conversations']['Insert'];

export class ConversationRepository {
  private get db() { return getSupabaseAdmin(); }

  async create(input: ConversationInsert) {
    const { data, error } = await this.db.from('conversations').insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async getHistory(roomId: string, userId: string, limit = 20) {
    const { data, error } = await this.db.from('conversations')
      .select('*')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async getRecent(limit = 50) {
    const { data, error } = await this.db.from('conversations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async markHelpful(id: number, helpful: boolean) {
    const { error } = await this.db.from('conversations').update({ was_helpful: helpful }).eq('id', id);
    if (error) throw error;
  }
}
