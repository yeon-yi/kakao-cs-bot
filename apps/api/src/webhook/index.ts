// ===================== Webhook 라우트 (Hono) =====================
import { Hono } from 'hono';
import { createLogger, getEnv } from '@kakao-cs-bot/config';
import { ProactiveRepository } from '@kakao-cs-bot/database';
import { query as dbQuery } from '@kakao-cs-bot/database';
import { aiGateway, humanizer } from '@kakao-cs-bot/ai';
import { timingSafeEqual } from 'crypto';
import { processMessage } from './message-processor';
import { getRedis, disconnectRedis, disconnectResponseCache } from './config-cache';
import { GREETING_TEMPLATES } from './constants';

const logger = createLogger('api:webhook');
const proactiveRepo = new ProactiveRepository();

export const webhookApp = new Hono();

// ===================== API Key 검증 (timing-safe, 헤더만 허용) =====================
webhookApp.use('*', async (c, next) => {
  const apiKey = c.req.header('X-Webhook-Secret') || c.req.header('X-API-Key');
  const secret = getEnv().WEBHOOK_SECRET;

  if (!secret || !apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const keyBuf = Buffer.from(apiKey, 'utf8');
    const secretBuf = Buffer.from(secret, 'utf8');
    if (keyBuf.length !== secretBuf.length || !timingSafeEqual(keyBuf, secretBuf)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
});

// ===================== 메시지 처리 =====================
webhookApp.post('/message', processMessage);

// ===================== 상태 확인 =====================
webhookApp.get('/status', async (c) => {
  return c.json({
    status: 'ok',
    operatingHours: humanizer.isOperatingHours(),
    timestamp: new Date().toISOString(),
  });
});

// ===================== 기기 모니터링 =====================

webhookApp.post('/device/register', async (c) => {
  try {
    const body = await c.req.json();
    const { deviceId, deviceName, deviceType, appVersion, osVersion } = body;
    if (!deviceId) return c.json({ error: 'deviceId required' }, 400);

    await dbQuery(
      `INSERT INTO connected_devices (device_id, device_name, device_type, app_version, os_version, status, last_heartbeat)
       VALUES ($1, $2, $3, $4, $5, 'online', NOW())
       ON CONFLICT (device_id) DO UPDATE SET
         device_name = COALESCE($2, connected_devices.device_name),
         device_type = COALESCE($3, connected_devices.device_type),
         app_version = COALESCE($4, connected_devices.app_version),
         os_version = COALESCE($5, connected_devices.os_version),
         status = 'online',
         last_heartbeat = NOW()`,
      [deviceId, deviceName || null, deviceType || 'android', appVersion || null, osVersion || null]
    );
    logger.info('Device registered', { deviceId, deviceName });
    return c.json({ success: true });
  } catch (error) {
    logger.error('Device register error', { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

webhookApp.post('/device/heartbeat', async (c) => {
  try {
    const body = await c.req.json();
    const { deviceId, messagesTotal, messagesToday, error: deviceError } = body;
    if (!deviceId) return c.json({ error: 'deviceId required' }, 400);

    if (deviceError) {
      await dbQuery(
        `INSERT INTO connected_devices (device_id, status, last_heartbeat, last_error, error_count)
         VALUES ($1, 'error', NOW(), $2, 1)
         ON CONFLICT (device_id) DO UPDATE SET
           status = 'error',
           last_heartbeat = NOW(),
           last_error = $2,
           error_count = connected_devices.error_count + 1`,
        [deviceId, deviceError]
      );
    } else {
      await dbQuery(
        `INSERT INTO connected_devices (device_id, status, last_heartbeat, messages_sent, messages_today)
         VALUES ($1, 'online', NOW(), COALESCE($2, 0), COALESCE($3, 0))
         ON CONFLICT (device_id) DO UPDATE SET
           status = 'online',
           last_heartbeat = NOW(),
           messages_sent = COALESCE($2, connected_devices.messages_sent),
           messages_today = COALESCE($3, connected_devices.messages_today),
           last_error = NULL`,
        [deviceId, messagesTotal ?? null, messagesToday ?? null]
      );
    }
    return c.json({ success: true });
  } catch (error) {
    logger.error('Device heartbeat error', { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ===================== 외부 알림 (관리 CRM → 카카오톡) =====================

webhookApp.post('/notify', async (c) => {
  try {
    const { roomId, message, messageType } = await c.req.json();
    if (!roomId || !message) {
      return c.json({ error: 'roomId, message 필수' }, 400);
    }
    await proactiveRepo.createMessage({
      room_id: roomId,
      message,
      message_type: messageType || 'staff_notification',
      status: 'pending',
      scheduled_at: new Date().toISOString(),
    });
    logger.info('External notification created', { roomId, messageType });
    return c.json({ success: true });
  } catch (error) {
    logger.error('Notify error', { error: String(error) });
    return c.json({ error: 'Failed to create notification' }, 500);
  }
});

// ===================== 프로액티브 메시징 =====================

webhookApp.get('/proactive/pending', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '5');
    const messages = await proactiveRepo.getPendingMessages(limit);
    return c.json({ messages, poll_interval_ms: 10000 });
  } catch (error) {
    logger.error('Proactive pending error', { error: String(error) });
    return c.json({ messages: [], error: 'Failed to fetch pending messages' });
  }
});

webhookApp.post('/proactive/report', async (c) => {
  try {
    const body = await c.req.json();
    const { id, status, error: errorMsg } = body;

    logger.info('Proactive report received', { id, status, errorMsg, bodyKeys: Object.keys(body) });

    if (!id || !status) {
      logger.warn('Proactive report missing fields', { id, status });
      return c.json({ error: 'id and status are required' }, 400);
    }

    if (status === 'sent') {
      await proactiveRepo.markSent(id);
      logger.info('Proactive marked sent', { id });
    } else if (status === 'failed') {
      await proactiveRepo.markFailed(id, errorMsg || 'unknown');
      logger.info('Proactive marked failed', { id, errorMsg });
    } else {
      logger.warn('Proactive unknown status', { id, status });
    }

    return c.json({ success: true });
  } catch (error) {
    logger.error('Proactive report error', { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ===================== n8n 자동화 =====================

webhookApp.post('/proactive/generate', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const inactiveDays = body.inactiveDays || 5;

    const inactiveRooms = await proactiveRepo.findInactiveRooms(inactiveDays);

    if (inactiveRooms.length === 0) {
      return c.json({ created: 0, rooms: [], message: '비활성 방 없음' });
    }

    const created: string[] = [];

    for (const room of inactiveRooms) {
      try {
        const template = GREETING_TEMPLATES[Math.floor(Math.random() * GREETING_TEMPLATES.length)];
        let greeting: string;

        try {
          const response = await aiGateway.generate({
            prompt: `다음 문안인사를 자연스럽게 변형해주세요. 원본 의미를 유지하면서 약간의 변화를 주세요.
친근하지만 프로페셔널하게, 2문장 이내로 작성하세요.
고객 이름: ${room.userName || '고객'}

원본: "${template}"

변형된 인사:`,
            systemPrompt: '광고 대행사 CS 담당자입니다. 간결하고 친근한 인사만 출력하세요.',
            temperature: 0.8,
            complexity: 'simple',
          });
          greeting = response.text.trim().replace(/^["']|["']$/g, '');
        } catch {
          greeting = template;
        }

        greeting = humanizer.humanizeResponse(greeting, { isThankYou: false });

        await proactiveRepo.createMessage({
          room_id: room.roomId,
          user_name: room.userName,
          message: greeting,
          message_type: 'greeting',
          last_activity: room.lastActivity,
          inactive_days: room.inactiveDays,
        });

        created.push(room.roomId);
      } catch (err) {
        logger.warn('Failed to create greeting', { roomId: room.roomId, error: String(err) });
      }
    }

    logger.info('n8n: Greetings generated', { count: created.length, inactiveDays });
    return c.json({ created: created.length, rooms: created });
  } catch (error) {
    logger.error('Proactive generate error', { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

webhookApp.get('/blocks/check', async (c) => {
  try {
    const roomId = c.req.query('roomId');
    if (!roomId) return c.json({ error: 'roomId required' }, 400);
    const blocked = await proactiveRepo.isBlocked(roomId);
    return c.json({ blocked });
  } catch (error) {
    return c.json({ blocked: false });
  }
});

// ===================== Cleanup exports (graceful shutdown 용) =====================
export { disconnectRedis, disconnectResponseCache };
