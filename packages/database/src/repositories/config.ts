import { getSupabaseAdmin } from '../client';

export class ConfigRepository {
  private get db() { return getSupabaseAdmin(); }

  async get(key: string) {
    const { data } = await this.db.from('app_config').select('*').eq('key', key).single();
    return data;
  }

  async list(category?: string) {
    let query = this.db.from('app_config').select('*');
    if (category) query = query.eq('category', category);
    const { data, error } = await query.order('key');
    if (error) throw error;
    return data ?? [];
  }

  async set(key: string, value: unknown, updatedBy?: string) {
    const { error } = await this.db.from('app_config').upsert({
      key, value: value as any, updated_by: updatedBy,
    });
    if (error) throw error;
  }
}

export class PromptRepository {
  private get db() { return getSupabaseAdmin(); }

  async get(name: string) {
    const { data } = await this.db.from('prompt_templates').select('*').eq('name', name).eq('is_active', true).single();
    return data;
  }

  async list() {
    const { data, error } = await this.db.from('prompt_templates').select('*').eq('is_active', true).order('name');
    if (error) throw error;
    return data ?? [];
  }

  async update(name: string, template: string, reason: string, changedBy: string) {
    const current = await this.get(name);
    if (!current) throw new Error(`Prompt not found: ${name}`);

    // Save history
    await this.db.from('prompt_history').insert({
      template_id: current.id, version: current.version, template: current.template,
      change_reason: reason, changed_by: changedBy,
    });

    // Update template
    const { data, error } = await this.db.from('prompt_templates').update({
      template, version: current.version + 1,
    }).eq('name', name).select().single();
    if (error) throw error;
    return data;
  }
}

export class AnalyticsRepository {
  private get db() { return getSupabaseAdmin(); }

  async getDaily(startDate: string, endDate: string) {
    const { data, error } = await this.db.from('analytics_daily').select('*')
      .gte('date', startDate).lte('date', endDate).order('date');
    if (error) throw error;
    return data ?? [];
  }

  async upsertDaily(date: string, updates: Record<string, unknown>) {
    const { error } = await this.db.from('analytics_daily').upsert({ date, ...updates } as any, { onConflict: 'date' });
    if (error) throw error;
  }
}
