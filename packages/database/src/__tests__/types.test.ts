import { describe, it, expect } from 'vitest';
import type { Database } from '../types';

describe('Database types', () => {
  it('should have knowledge_base table type', () => {
    type KB = Database['public']['Tables']['knowledge_base']['Row'];
    const check: KB extends { id: string; question: string } ? true : false = true;
    expect(check).toBe(true);
  });

  it('should have escalations table type', () => {
    type Esc = Database['public']['Tables']['escalations']['Row'];
    const check: Esc extends { id: number; user_message: string; status: string } ? true : false = true;
    expect(check).toBe(true);
  });

  it('should have conversations table type', () => {
    type Conv = Database['public']['Tables']['conversations']['Row'];
    const check: Conv extends { id: number; room_id: string } ? true : false = true;
    expect(check).toBe(true);
  });

  it('should have search_knowledge function type', () => {
    type SearchFn = Database['public']['Functions']['search_knowledge'];
    const check: SearchFn extends { Args: { query_embedding: number[] }; Returns: any[] } ? true : false = true;
    expect(check).toBe(true);
  });
});
