import { getSupabaseAdmin } from '../client';
import type { Database } from '../types';

type EscalationInsert = Database['public']['Tables']['escalations']['Insert'];

export class EscalationRepository {
  private get db() { return getSupabaseAdmin(); }

  async create(input: EscalationInsert) {
    const { data, error } = await this.db.from('escalations').insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async getById(id: number) {
    const { data, error } = await this.db.from('escalations').select('*').eq('id', id).single();
    if (error) return null;
    return data;
  }

  async list(options?: { status?: string; category?: string; assignedTo?: number; offset?: number; limit?: number }) {
    let query = this.db.from('escalations').select('*', { count: 'exact' });
    if (options?.status) query = query.eq('status', options.status);
    if (options?.category) query = query.eq('category', options.category);
    if (options?.assignedTo) query = query.eq('assigned_to', options.assignedTo);
    query = query.order('created_at', { ascending: false });
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 20;
    query = query.range(offset, offset + limit - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async assign(id: number, staffId: number) {
    const { data, error } = await this.db.from('escalations').update({
      assigned_to: staffId,
      assigned_at: new Date().toISOString(),
      status: 'assigned',
    }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async answer(id: number, answer: string, answeredBy: string) {
    const { data, error } = await this.db.from('escalations').update({
      answer,
      answered_by: answeredBy,
      answered_at: new Date().toISOString(),
      status: 'answered',
    }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async markLearned(id: number, knowledgeId: string) {
    const { error } = await this.db.from('escalations').update({
      knowledge_id: knowledgeId,
      status: 'learned',
    }).eq('id', id);
    if (error) throw error;
  }

  async markReplied(id: number) {
    const { error } = await this.db.from('escalations').update({
      replied_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
  }

  async dismiss(id: number) {
    const { error } = await this.db.from('escalations').update({
      status: 'dismissed',
    }).eq('id', id);
    if (error) throw error;
  }

  async pendingCount() {
    const { count, error } = await this.db.from('escalations')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'assigned']);
    if (error) throw error;
    return count ?? 0;
  }

  // Category assignees
  async getAssignees() {
    const { data, error } = await this.db.from('category_assignees')
      .select('*, company_staff(id, real_name, department, kakao_name)')
      .order('category');
    if (error) throw error;
    return data ?? [];
  }

  async setAssignee(category: string, staffId: number) {
    const { data, error } = await this.db.from('category_assignees').upsert({
      category, staff_id: staffId,
    }, { onConflict: 'category' }).select().single();
    if (error) throw error;
    return data;
  }

  async removeAssignee(category: string) {
    const { error } = await this.db.from('category_assignees').delete().eq('category', category);
    if (error) throw error;
  }

  async getAssigneeByCategory(category: string) {
    const { data } = await this.db.from('category_assignees')
      .select('*, company_staff(id, real_name, kakao_name)')
      .eq('category', category)
      .single();
    return data;
  }
}
