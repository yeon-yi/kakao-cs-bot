package com.csbot.kakao

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class BotService : Service() {

    private var scheduler: ScheduledExecutorService? = null
    private var proactiveTask: ScheduledFuture<*>? = null
    private var heartbeatTask: ScheduledFuture<*>? = null

    companion object {
        var isRunning = false
            private set
        private const val HEARTBEAT_INTERVAL_MS = 30_000L
        private const val DEVICE_REGISTER_DELAY_MS = 1_000L
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        try {
            isRunning = true
            scheduler = Executors.newScheduledThreadPool(2)
            startForegroundNotification()
            startProactivePolling()
            startHeartbeat()
            LogManager.i("봇 서비스 시작")
        } catch (e: Exception) {
            LogManager.e("서비스 시작 실패: ${e.javaClass.simpleName}: ${e.message}")
            try { App.prefs.botEnabled = false } catch (_: Exception) {}
            isRunning = false
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        proactiveTask?.cancel(false)
        heartbeatTask?.cancel(false)
        scheduler?.shutdown()
        try {
            scheduler?.awaitTermination(3, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            scheduler?.shutdownNow()
        }
        scheduler = null
        LogManager.i("봇 서비스 중지")
    }

    private fun startForegroundNotification() {
        val openIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, "bot_service")
            .setContentTitle("CS봇 작동 중")
            .setContentText("카카오톡 메시지 응답 대기 중")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()

        startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    }

    private fun startHeartbeat() {
        // Device registration (one-time, delayed)
        scheduler?.schedule({
            try {
                val registered = ApiClient.registerDevice()
                if (registered) {
                    LogManager.d("기기 등록 완료: ${App.prefs.deviceId}")
                }
            } catch (e: Exception) {
                LogManager.e("기기 등록 오류: ${e.message}")
            }
        }, DEVICE_REGISTER_DELAY_MS, TimeUnit.MILLISECONDS)

        // Periodic heartbeat
        heartbeatTask = scheduler?.scheduleAtFixedRate({
            try {
                ApiClient.sendHeartbeat()
            } catch (_: Exception) {}
        }, HEARTBEAT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, TimeUnit.MILLISECONDS)
    }

    private fun startProactivePolling() {
        val pollMs = App.prefs.proactivePollMs
        proactiveTask = scheduler?.scheduleAtFixedRate({
            try {
                if (!App.prefs.botEnabled) return@scheduleAtFixedRate
                val messages = ApiClient.fetchPendingProactive()
                if (messages.isEmpty()) return@scheduleAtFixedRate

                for (msg in messages) {
                    val success = BotEngine.handleProactive(msg.roomId, msg.message)
                    if (success) {
                        ApiClient.reportProactive(msg.id, "sent")
                    } else {
                        ApiClient.reportProactive(msg.id, "failed", "no_reply_action")
                    }
                }
            } catch (e: Exception) {
                LogManager.e("프로액티브 폴링 오류: ${e.message}")
            }
        }, pollMs, pollMs, TimeUnit.MILLISECONDS)
    }
}
