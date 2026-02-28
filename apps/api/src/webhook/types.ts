// ===================== Webhook 타입 정의 =====================

export interface WebhookConfigCache {
  botMode: string;
  testRooms: string[];
  opStart: string;
  opEnd: string;
  escalationThreshold: number;
  botKakaoName: string;
  loadedAt: number;
}

export interface CustomerToneProfile {
  formalityLevel: 'formal' | 'semi-formal' | 'casual';
  usesEmoji: boolean;
  messageLength: 'short' | 'medium' | 'long';
  honorific: string;
}

export interface PersistedCustomerProfile {
  formalityLevel: 'formal' | 'semi-formal' | 'casual';
  usesEmoji: boolean;
  avgMessageLength: 'short' | 'medium' | 'long';
  honorific: string;
  interactionCount: number;
  lastUpdated: number;
}

export interface NonTextMessageParams {
  roomId: string;
  userName: string;
  message: string;
  isGroupChat?: boolean;
  messageType: string;
  imageUrl?: string;
  startTime: number;
}

export interface CreateEscalationParams {
  roomId: string;
  userName: string;
  message: string;
  answer: string;
  confidence: number | null;
  conversationId?: number | null;
  escalationType?: 'low_confidence' | 'soft' | 'photo' | 'video';
  includeContext?: boolean;
  contextOverride?: string;  // 이미 만들어진 컨텍스트 문자열
}
