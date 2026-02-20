import { query, queryOne, getPool } from '../client';

export class ConfigRepository {
  async get(key: string) {
    return queryOne('SELECT * FROM app_config WHERE key = $1', [key]);
  }

  async list(category?: string) {
    if (category) {
      return query('SELECT * FROM app_config WHERE category = $1 ORDER BY key', [category]);
    }
    return query('SELECT * FROM app_config ORDER BY key');
  }

  async set(key: string, value: unknown, updatedBy?: string) {
    await query(
      `INSERT INTO app_config (key, value, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value), updatedBy ?? null]
    );
  }
}

export class PromptRepository {
  async get(name: string) {
    return queryOne(
      'SELECT * FROM prompt_templates WHERE name = $1 AND is_active = true',
      [name]
    );
  }

  async list() {
    return query('SELECT * FROM prompt_templates WHERE is_active = true ORDER BY name');
  }

  async update(name: string, template: string, reason: string, changedBy: string) {
    const current = await this.get(name);
    if (!current) throw new Error(`Prompt not found: ${name}`);

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Save history
      await client.query(
        `INSERT INTO prompt_history (template_id, version, template, change_reason, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [current.id, current.version, current.template, reason, changedBy]
      );

      // Update template
      const { rows } = await client.query(
        `UPDATE prompt_templates SET template = $1, version = $2 WHERE name = $3 RETURNING *`,
        [template, current.version + 1, name]
      );

      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export class AnalyticsRepository {
  async getDaily(startDate: string, endDate: string) {
    return query(
      'SELECT * FROM analytics_daily WHERE date >= $1 AND date <= $2 ORDER BY date',
      [startDate, endDate]
    );
  }

  async upsertDaily(date: string, updates: Record<string, unknown>) {
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClauses = keys.map((k, i) => `${k} = EXCLUDED.${k}`).join(', ');
    const colNames = ['date', ...keys].join(', ');
    const placeholders = ['$1', ...keys.map((_, i) => `$${i + 2}`)].join(', ');

    await query(
      `INSERT INTO analytics_daily (${colNames}) VALUES (${placeholders})
       ON CONFLICT (date) DO UPDATE SET ${setClauses}`,
      [date, ...values]
    );
  }
}
