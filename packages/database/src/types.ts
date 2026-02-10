export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      knowledge_base: {
        Row: {
          id: string;
          tier: number;
          question: string;
          answer: string | null;
          category: string | null;
          embedding: number[] | null;
          source: string | null;
          taught_by: string | null;
          tags: string[] | null;
          notes: string | null;
          usage_count: number;
          confidence_score: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tier: number;
          question: string;
          answer?: string | null;
          category?: string | null;
          embedding?: number[] | null;
          source?: string | null;
          taught_by?: string | null;
          tags?: string[] | null;
          notes?: string | null;
          usage_count?: number;
          confidence_score?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tier?: number;
          question?: string;
          answer?: string | null;
          category?: string | null;
          embedding?: number[] | null;
          source?: string | null;
          taught_by?: string | null;
          tags?: string[] | null;
          notes?: string | null;
          usage_count?: number;
          confidence_score?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      knowledge_history: {
        Row: {
          id: number;
          knowledge_id: string | null;
          action: string;
          previous_question: string | null;
          previous_answer: string | null;
          new_question: string | null;
          new_answer: string | null;
          change_reason: string | null;
          changed_by: string;
          changed_at: string;
        };
        Insert: {
          id?: number;
          knowledge_id?: string | null;
          action: string;
          previous_question?: string | null;
          previous_answer?: string | null;
          new_question?: string | null;
          new_answer?: string | null;
          change_reason?: string | null;
          changed_by: string;
          changed_at?: string;
        };
        Update: {
          id?: number;
          knowledge_id?: string | null;
          action?: string;
          previous_question?: string | null;
          previous_answer?: string | null;
          new_question?: string | null;
          new_answer?: string | null;
          change_reason?: string | null;
          changed_by?: string;
          changed_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: number;
          room_id: string;
          user_id: string;
          user_name: string | null;
          user_message: string;
          bot_response: string | null;
          context: Json;
          knowledge_tier: number | null;
          ai_model: string | null;
          confidence: number | null;
          was_helpful: boolean | null;
          response_time_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          room_id: string;
          user_id: string;
          user_name?: string | null;
          user_message: string;
          bot_response?: string | null;
          context?: Json;
          knowledge_tier?: number | null;
          ai_model?: string | null;
          confidence?: number | null;
          was_helpful?: boolean | null;
          response_time_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          room_id?: string;
          user_id?: string;
          user_name?: string | null;
          user_message?: string;
          bot_response?: string | null;
          context?: Json;
          knowledge_tier?: number | null;
          ai_model?: string | null;
          confidence?: number | null;
          was_helpful?: boolean | null;
          response_time_ms?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      room_members: {
        Row: {
          id: number;
          room_id: string;
          user_id: string;
          user_name: string | null;
          role: string;
          confirmed_by: string | null;
          confidence: number;
          joined_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          room_id: string;
          user_id: string;
          user_name?: string | null;
          role?: string;
          confirmed_by?: string | null;
          confidence?: number;
          joined_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          room_id?: string;
          user_id?: string;
          user_name?: string | null;
          role?: string;
          confirmed_by?: string | null;
          confidence?: number;
          joined_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      company_staff: {
        Row: {
          id: number;
          kakao_user_id: string | null;
          kakao_name: string | null;
          real_name: string;
          email: string | null;
          phone: string | null;
          department: string | null;
          position: string | null;
          is_active: boolean;
          added_at: string;
          added_by: string | null;
        };
        Insert: {
          id?: number;
          kakao_user_id?: string | null;
          kakao_name?: string | null;
          real_name: string;
          email?: string | null;
          phone?: string | null;
          department?: string | null;
          position?: string | null;
          is_active?: boolean;
          added_at?: string;
          added_by?: string | null;
        };
        Update: {
          id?: number;
          kakao_user_id?: string | null;
          kakao_name?: string | null;
          real_name?: string;
          email?: string | null;
          phone?: string | null;
          department?: string | null;
          position?: string | null;
          is_active?: boolean;
          added_at?: string;
          added_by?: string | null;
        };
        Relationships: [];
      };
      staff_aliases: {
        Row: {
          id: number;
          staff_id: number | null;
          alias: string;
          platform: string;
        };
        Insert: {
          id?: number;
          staff_id?: number | null;
          alias: string;
          platform?: string;
        };
        Update: {
          id?: number;
          staff_id?: number | null;
          alias?: string;
          platform?: string;
        };
        Relationships: [];
      };
      message_queue: {
        Row: {
          id: string;
          data: Json;
          status: string;
          priority: string;
          assigned_to: string | null;
          attempts: number;
          last_error: string | null;
          created_at: string;
          processing_started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          data: Json;
          status?: string;
          priority?: string;
          assigned_to?: string | null;
          attempts?: number;
          last_error?: string | null;
          created_at?: string;
          processing_started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          data?: Json;
          status?: string;
          priority?: string;
          assigned_to?: string | null;
          attempts?: number;
          last_error?: string | null;
          created_at?: string;
          processing_started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      app_config: {
        Row: {
          key: string;
          value: Json;
          category: string | null;
          description: string | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          category?: string | null;
          description?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          category?: string | null;
          description?: string | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      prompt_templates: {
        Row: {
          id: number;
          name: string;
          template: string;
          version: number;
          variables: Json;
          category: string | null;
          description: string | null;
          is_active: boolean;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: number;
          name: string;
          template: string;
          version?: number;
          variables?: Json;
          category?: string | null;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: number;
          name?: string;
          template?: string;
          version?: number;
          variables?: Json;
          category?: string | null;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      prompt_history: {
        Row: {
          id: number;
          template_id: number | null;
          version: number;
          template: string;
          change_reason: string | null;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: {
          id?: number;
          template_id?: number | null;
          version: number;
          template: string;
          change_reason?: string | null;
          changed_by?: string | null;
          changed_at?: string;
        };
        Update: {
          id?: number;
          template_id?: number | null;
          version?: number;
          template?: string;
          change_reason?: string | null;
          changed_by?: string | null;
          changed_at?: string;
        };
        Relationships: [];
      };
      analytics_daily: {
        Row: {
          id: number;
          date: string;
          total_messages: number;
          auto_responses: number;
          admin_escalations: number;
          avg_response_time_ms: number | null;
          p95_response_time_ms: number | null;
          gemini_calls: number;
          claude_calls: number;
          total_ai_cost: number;
          helpful_count: number;
          not_helpful_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          date: string;
          total_messages?: number;
          auto_responses?: number;
          admin_escalations?: number;
          avg_response_time_ms?: number | null;
          p95_response_time_ms?: number | null;
          gemini_calls?: number;
          claude_calls?: number;
          total_ai_cost?: number;
          helpful_count?: number;
          not_helpful_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          date?: string;
          total_messages?: number;
          auto_responses?: number;
          admin_escalations?: number;
          avg_response_time_ms?: number | null;
          p95_response_time_ms?: number | null;
          gemini_calls?: number;
          claude_calls?: number;
          total_ai_cost?: number;
          helpful_count?: number;
          not_helpful_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      search_knowledge: {
        Args: {
          query_embedding: number[];
          query_text: string;
          p_tier?: number;
          p_category?: string;
          p_limit?: number;
        };
        Returns: Array<{
          id: string;
          question: string;
          answer: string;
          category: string;
          similarity: number;
          tier: number;
          source: string;
          usage_count: number;
        }>;
      };
      increment_usage_count: {
        Args: { knowledge_uuid: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
