// ===================== 톤 분석 + 고객 프로필 =====================
import { createLogger } from '@kakao-cs-bot/config';
import { query as dbQuery } from '@kakao-cs-bot/database';
import type { CustomerToneProfile, PersistedCustomerProfile } from './types';
import { getRedis } from './config-cache';

const logger = createLogger('api:webhook:tone');

// ===================== 톤 감지 =====================
export function detectCustomerTone(message: string, historyContext: string): CustomerToneProfile {
  const allText = `${message} ${historyContext}`;

  let formalityLevel: CustomerToneProfile['formalityLevel'] = 'formal';
  const casualPatterns = /ㅋㅋ|ㅎㅎ|ㅇㅇ|ㅇㅋ|ㄱㅅ|ㄴㄴ|반말|해줘|해봐|알려줘[^요]|뭐야|왜[?？]|그래\?/;
  const semiFormalPatterns = /~요|해요|인가요|인데요|할게요|줄게요|어떤가요|괜찮나요/;

  if (casualPatterns.test(allText)) {
    formalityLevel = 'casual';
  } else if (semiFormalPatterns.test(allText)) {
    formalityLevel = 'semi-formal';
  }

  const usesEmoji = /[😀-😿🙀-🙏🤗-🤹👍-👻💀-💿🎀-🏿🐀-🔿🕐-🗿😊🥰🤔💪🔥❤️✨⭐️🎉👏💕🥺😂😅😍🙏💯🎵☺️]/u.test(allText)
    || /\^\^|ㅋㅋ|ㅎㅎ|:\)|:D|XD/.test(allText);

  const avgLen = message.length;
  const messageLength = avgLen < 30 ? 'short' : avgLen < 100 ? 'medium' : 'long';

  let honorific = '대표님';
  if (/담당자님/.test(allText)) honorific = '담당자님';
  else if (/선생님/.test(allText)) honorific = '선생님';

  return { formalityLevel, usesEmoji, messageLength, honorific };
}

// ===================== 톤 미러링 프롬프트 생성 =====================
export function buildToneMirrorInstructions(tone: CustomerToneProfile): string {
  const lines: string[] = [];

  switch (tone.formalityLevel) {
    case 'casual':
      lines.push('- 고객이 캐주얼한 말투를 사용하므로 살짝 부드러운 존댓말 (~요 체) 사용 가능');
      lines.push('- 너무 딱딱하지 않게, 친근하면서도 프로페셔널하게');
      break;
    case 'semi-formal':
      lines.push('- 고객이 반존댓말을 사용하므로 자연스러운 존댓말 (~요 체 위주) 사용');
      break;
    default:
      lines.push('- 격식체 존댓말 (~습니다 체) 사용');
      break;
  }

  if (tone.usesEmoji) {
    lines.push('- 고객이 이모지를 사용하므로, 적절한 곳에 이모지 1~2개 가볍게 활용 가능');
  } else {
    lines.push('- 이모지 사용 자제');
  }

  if (tone.messageLength === 'short') {
    lines.push('- 고객이 짧은 메시지를 선호하므로 1~2문장으로 간결하게 답변');
  } else if (tone.messageLength === 'long') {
    lines.push('- 고객이 상세한 질문을 하므로 충분히 설명하되 3~5문장 이내');
  }

  return lines.join('\n');
}

// ===================== 고객 프로필 영속화 (Redis + PostgreSQL) =====================
export async function getCustomerProfile(roomId: string): Promise<PersistedCustomerProfile | null> {
  try {
    // 1. Redis 조회 (빠른 경로)
    const data = await getRedis().get(`customer:profile:${roomId}`);
    if (data) return JSON.parse(data);

    // 2. PostgreSQL 폴백
    const row = await dbQuery(
      'SELECT * FROM customer_profiles WHERE room_id = $1',
      [roomId]
    ).then(rows => rows[0]).catch(() => null);

    if (row) {
      const profile: PersistedCustomerProfile = {
        formalityLevel: row.formality_level || 'formal',
        usesEmoji: row.uses_emoji ?? false,
        avgMessageLength: row.avg_message_length || 'medium',
        honorific: row.honorific || '',
        interactionCount: row.interaction_count ?? 0,
        lastUpdated: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
      };
      // Redis에 재캐시 (30일 TTL)
      await getRedis().setex(`customer:profile:${roomId}`, 86400 * 30, JSON.stringify(profile)).catch(() => {});
      return profile;
    }

    return null;
  } catch { return null; }
}

export async function updateCustomerProfile(roomId: string, detected: CustomerToneProfile): Promise<void> {
  try {
    const existing = await getCustomerProfile(roomId);
    const profile: PersistedCustomerProfile = existing || {
      formalityLevel: detected.formalityLevel,
      usesEmoji: detected.usesEmoji,
      avgMessageLength: detected.messageLength,
      honorific: detected.honorific,
      interactionCount: 0,
      lastUpdated: Date.now(),
    };

    profile.interactionCount++;
    profile.lastUpdated = Date.now();

    if (profile.interactionCount > 1) {
      if (detected.formalityLevel !== profile.formalityLevel) {
        const countKey = `customer:tone_shift:${roomId}`;
        const shiftCount = await getRedis().incr(countKey);
        await getRedis().expire(countKey, 1800);
        if (shiftCount >= 3) {
          profile.formalityLevel = detected.formalityLevel;
          await getRedis().del(countKey);
        }
      } else {
        await getRedis().del(`customer:tone_shift:${roomId}`).catch(() => {});
      }
      profile.usesEmoji = detected.usesEmoji || profile.usesEmoji;
      profile.avgMessageLength = detected.messageLength;
      profile.honorific = detected.honorific || profile.honorific;
    } else {
      profile.formalityLevel = detected.formalityLevel;
      profile.usesEmoji = detected.usesEmoji;
      profile.avgMessageLength = detected.messageLength;
      profile.honorific = detected.honorific;
    }

    // Redis 저장 (30일 TTL)
    await getRedis().setex(`customer:profile:${roomId}`, 86400 * 30, JSON.stringify(profile));

    // PostgreSQL 비동기 저장 (영구 백업)
    dbQuery(
      `INSERT INTO customer_profiles (room_id, formality_level, uses_emoji, avg_message_length, honorific, interaction_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (room_id) DO UPDATE SET
         formality_level = $2, uses_emoji = $3, avg_message_length = $4,
         honorific = $5, interaction_count = $6, updated_at = NOW()`,
      [roomId, profile.formalityLevel, profile.usesEmoji, profile.avgMessageLength, profile.honorific, profile.interactionCount]
    ).catch((e) => logger.warn('Customer profile DB save failed', { error: String(e) }));
  } catch (e) {
    logger.warn('Customer profile update failed', { error: String(e) });
  }
}
