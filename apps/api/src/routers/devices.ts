import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { query as dbQuery, queryOne as dbQueryOne } from '@kakao-cs-bot/database';

const OFFLINE_THRESHOLD_MS = 90_000; // 90초 무응답이면 offline

export const devicesRouter = router({
  list: protectedProcedure.query(async () => {
    const devices = await dbQuery(
      `SELECT *,
         CASE
           WHEN status = 'error' THEN 'error'
           WHEN last_heartbeat < NOW() - INTERVAL '90 seconds' THEN 'offline'
           ELSE 'online'
         END as computed_status
       FROM connected_devices
       ORDER BY last_heartbeat DESC`,
      []
    );

    // offline 상태 자동 업데이트
    await dbQuery(
      `UPDATE connected_devices SET status = 'offline'
       WHERE status = 'online' AND last_heartbeat < NOW() - INTERVAL '90 seconds'`,
      []
    ).catch(() => {});

    return devices.map((d: any) => ({
      id: d.id,
      deviceId: d.device_id,
      deviceName: d.device_name,
      deviceType: d.device_type,
      appVersion: d.app_version,
      osVersion: d.os_version,
      status: d.computed_status || d.status,
      lastHeartbeat: d.last_heartbeat,
      lastError: d.last_error,
      errorCount: d.error_count,
      messagesSent: d.messages_sent,
      messagesToday: d.messages_today,
      registeredAt: d.registered_at,
    }));
  }),

  summary: protectedProcedure.query(async () => {
    const stats = await dbQueryOne(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN status = 'online' AND last_heartbeat >= NOW() - INTERVAL '90 seconds' THEN 1 END) as online,
         COUNT(CASE WHEN status = 'error' THEN 1 END) as error,
         COUNT(CASE WHEN status = 'offline' OR (status = 'online' AND last_heartbeat < NOW() - INTERVAL '90 seconds') THEN 1 END) as offline,
         SUM(messages_today) as total_messages_today
       FROM connected_devices`,
      []
    );
    return {
      total: Number(stats?.total ?? 0),
      online: Number(stats?.online ?? 0),
      error: Number(stats?.error ?? 0),
      offline: Number(stats?.offline ?? 0),
      totalMessagesToday: Number(stats?.total_messages_today ?? 0),
    };
  }),

  remove: protectedProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ input }) => {
      await dbQuery('DELETE FROM connected_devices WHERE device_id = $1', [input.deviceId]);
      return { success: true };
    }),

  resetError: protectedProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ input }) => {
      await dbQuery(
        `UPDATE connected_devices SET status = 'offline', last_error = NULL, error_count = 0 WHERE device_id = $1`,
        [input.deviceId]
      );
      return { success: true };
    }),
});
