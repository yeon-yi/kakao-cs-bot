// ===================== 에스컬레이션 서비스 (통합) =====================
import { createLogger } from '@kakao-cs-bot/config';
import {
  EscalationRepository,
  ConversationRepository,
  ProactiveRepository,
  query as dbQuery,
  queryOne as dbQueryOne,
} from '@kakao-cs-bot/database';
import { aiGateway } from '@kakao-cs-bot/ai';
import type { CreateEscalationParams } from './types';
import { VALID_CATEGORIES, FIRST_ESCALATION_TEMPLATES, FOLLOWUP_ESCALATION_TEMPLATES } from './constants';
import { getCustomerProfile } from './tone-analyzer';

const logger = createLogger('api:webhook:escalation');
const escalationRepo = new EscalationRepository();
const conversationRepo = new ConversationRepository();
const proactiveRepo = new ProactiveRepository();

// ===================== 방 내 직원 찾기 =====================
export async function findStaffInRoom(roomId: string): Promise<{ staffId: number; staffName: string } | null> {
  const row = await dbQueryOne(
    `SELECT rm.user_id, rm.user_name, cs.id as staff_id, cs.real_name, cs.department
     FROM room_members rm
     JOIN company_staff cs ON cs.kakao_name = rm.user_name AND cs.is_active = true
     WHERE rm.room_id = $1 AND rm.role = 'company_staff'
     ORDER BY rm.updated_at DESC
     LIMIT 1`,
    [roomId]
  );
  if (row) {
    return { staffId: row.staff_id, staffName: row.real_name };
  }
  return null;
}

// ===================== 담당자 배정 (room > category) =====================
export async function resolveAssignee(
  roomId: string,
  category: string | null,
): Promise<{ staffId: number | null; source: string }> {
  // 1) 톡방 소속 직원 우선
  const roomStaff = await findStaffInRoom(roomId).catch(() => null);
  if (roomStaff) {
    return { staffId: roomStaff.staffId, source: `room_staff:${roomStaff.staffName}` };
  }

  // 2) 카테고리 담당자
  if (category) {
    const categoryAssignee = await escalationRepo.getAssigneeByCategory(category, roomId).catch(() => null);
    if (categoryAssignee) {
      return { staffId: (categoryAssignee as any).staff_id, source: `category:${category}` };
    }
  }

  return { staffId: null, source: 'none' };
}

// ===================== 에스컬레이션 통합 생성 =====================
export async function createEscalation(params: CreateEscalationParams): Promise<void> {
  const {
    roomId, userName, message, answer, confidence,
    conversationId, escalationType = 'low_confidence',
    includeContext = false, contextOverride,
  } = params;

  // 카테고리 분류
  const category = await classifyCategory(message);

  // 담당자 배정
  const { staffId: assignedStaffId, source: assignedSource } = await resolveAssignee(roomId, category);

  // 컨텍스트 수집 (hard escalation에만)
  let userMessage = message;
  if (contextOverride) {
    userMessage = `${message}\n\n--- 컨텍스트 ---\n${contextOverride}`;
  } else if (includeContext) {
    try {
      const parts: string[] = [];
      // 최근 대화 직접 조회 (순환 참조 방지)
      const recentConvs = await conversationRepo.getHistory(roomId, userName, 5).catch(() => []);
      if (recentConvs && recentConvs.length > 0) {
        const historyLines = recentConvs.reverse().map((h: any) => {
          const lines: string[] = [];
          if (h.user_message) lines.push(`[고객] ${h.user_message}`);
          if (h.bot_response) lines.push(`[나] ${h.bot_response}`);
          return lines.join('\n');
        }).join('\n');
        parts.push(`[최근 대화]\n${historyLines.substring(0, 500)}`);
      }
      const prevEscalations = await escalationRepo.list({
        status: undefined, offset: 0, limit: 3,
      }).catch(() => ({ items: [] }));
      const roomEscalations = (prevEscalations as any)?.items?.filter?.((e: any) => e.room_id === roomId) || [];
      if (roomEscalations.length > 0) {
        const esc = roomEscalations.slice(0, 3).map((e: any) =>
          `${e.created_at?.substring(0, 10) || '?'}: "${(e.user_message || '').substring(0, 80)}" → ${e.status}`
        ).join('\n');
        parts.push(`[이전 에스컬레이션]\n${esc}`);
      }
      const profile = await getCustomerProfile(roomId);
      if (profile) {
        parts.push(`[고객 프로필] 격식:${profile.formalityLevel}, 대화${profile.interactionCount}회`);
      }
      if (parts.length > 0) {
        userMessage = `${message}\n\n--- 컨텍스트 ---\n${parts.join('\n\n')}`;
      }
    } catch {}
  }

  await escalationRepo.create({
    conversation_id: conversationId,
    room_id: roomId,
    user_id: userName || 'unknown',
    user_name: userName,
    user_message: userMessage,
    bot_response: answer,
    category,
    confidence,
    status: assignedStaffId ? 'assigned' : 'pending',
    assigned_to: assignedStaffId,
    assigned_at: assignedStaffId ? new Date().toISOString() : null,
    escalation_type: escalationType,
  });

  logger.info('Escalation created', {
    roomId, userName, category, type: escalationType,
    similarity: confidence, assignedTo: assignedSource,
  });

  // 담당자 개인 카카오톡 알림 (프로액티브 메시지)
  if (assignedStaffId) {
    try {
      const staff = await dbQueryOne(
        'SELECT kakao_room_id, real_name FROM company_staff WHERE id = $1 AND kakao_room_id IS NOT NULL',
        [assignedStaffId]
      );
      if (staff?.kakao_room_id) {
        const msgText = message.length > 100 ? message.substring(0, 100) + '...' : message;
        await proactiveRepo.createMessage({
          room_id: staff.kakao_room_id,
          user_name: staff.real_name,
          message: `[에스컬레이션 알림]\n톡방: ${roomId}\n고객: ${userName}\n문의: ${msgText}\n카테고리: ${category || '일반'}`,
          message_type: 'staff_notification',
        });
        logger.info('Staff notification queued', { staffId: assignedStaffId, staffRoom: staff.kakao_room_id });
      }
    } catch (e) {
      logger.warn('Staff notification failed', { error: String(e) });
    }
  }
}

// ===================== 에스컬레이션 메시지 =====================
const recentEscMessages = new Map<string, string[]>(); // roomId → 최근 사용 메시지

export function getEscalationMessage(previousEscalationCount: number = 0, roomId?: string): string {
  const templates = previousEscalationCount >= 1 ? FOLLOWUP_ESCALATION_TEMPLATES : FIRST_ESCALATION_TEMPLATES;

  // 최근 사용한 템플릿과 겹치지 않도록 필터링
  const recentUsed = roomId ? (recentEscMessages.get(roomId) || []) : [];
  const available = templates.filter(t => !recentUsed.includes(t));
  const pool = available.length > 0 ? available : templates;

  const selected = pool[Math.floor(Math.random() * pool.length)];

  // 최근 사용 기록 업데이트 (최대 5개 유지)
  if (roomId) {
    const recent = recentUsed.slice(-4);
    recent.push(selected);
    recentEscMessages.set(roomId, recent);
  }

  return selected;
}

// ===================== AI 카테고리 분류 =====================
export async function classifyCategory(message: string, historyContext?: string): Promise<string> {
  try {
    const contextSection = historyContext
      ? `\n최근 대화 맥락:\n${historyContext.slice(0, 500)}\n`
      : '';

    const response = await aiGateway.generate({
      prompt: `고객 질문을 아래 카테고리 중 하나로 분류하세요. 카테고리 이름만 정확히 출력하세요.

카테고리 및 예시:
- 네이버트래픽: 네이버 검색 유입, 트래픽 순위, 검색 노출, 네이버 광고 성과
- 블로그기자단: 블로그 포스팅 일정, 기자단 원고, 블로그 리뷰, 체험단
- 인스타그램: 인스타 팔로워, 릴스, 피드, 인스타 광고, 해시태그
- 홈페이지: 홈페이지 수정, 웹사이트 제작, 랜딩페이지, 도메인
- SEO: 구글 검색 순위, SEO 최적화, 검색엔진, 구글 노출
- 영상촬영: 촬영 일정, 영상 편집, 유튜브, 숏폼, 촬영 장소
- 일반: 결제, 계약서, 견적, 일반 문의, 위 카테고리에 해당하지 않는 것
${contextSection}
질문: "${message}"

카테고리:`,
      systemPrompt: '광고 대행사 CS 카테고리 분류기입니다. 위 7개 카테고리 중 하나만 정확히 출력하세요. 설명이나 부연 없이 카테고리 이름만 출력합니다.',
      temperature: 0.1,
      complexity: 'simple',
    });
    const cat = response.text.trim().replace(/["\n]/g, '');
    return VALID_CATEGORIES.includes(cat) ? cat : '일반';
  } catch {
    return '일반';
  }
}

// ===================== 불확실 주제 기록 =====================
export async function recordUncertainty(
  question: string, category: string, similarity: number,
  source?: string
): Promise<void> {
  const detectedSource = source || (similarity < 0.3 ? 'new_topic' : 'low_similarity');

  const existing = await dbQueryOne(
    `SELECT id, occurrence_count, avg_similarity FROM uncertainty_topics
     WHERE category = $1 AND status = 'open'
     AND similarity(topic, $2) > 0.5
     LIMIT 1`,
    [category, question]
  ).catch(() => null);

  if (existing) {
    await dbQuery(
      `UPDATE uncertainty_topics
       SET occurrence_count = occurrence_count + 1,
           avg_similarity = ($1 + avg_similarity * occurrence_count) / (occurrence_count + 1),
           last_seen_at = NOW(),
           sample_question = CASE WHEN LENGTH($2) > LENGTH(sample_question) THEN $2 ELSE sample_question END
       WHERE id = $3`,
      [similarity, question, existing.id]
    ).catch(() => {});
  } else {
    await dbQuery(
      `INSERT INTO uncertainty_topics (topic, category, sample_question, source, avg_similarity)
       VALUES ($1, $2, $3, $4, $5)`,
      [question.substring(0, 200), category, question, detectedSource, similarity]
    ).catch(() => {});
  }
}
