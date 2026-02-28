package com.csbot.kakao

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.Timer
import java.util.TimerTask

class BotService : Service() {

    private var proactiveTimer: Timer? = null
    private var heartbeatTimer: Timer? = null

    companion object {
        var isRunning = false
            private set
        private const val HEARTBEAT_INTERVAL_MS = 30_000L
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        try {
            isRunning = true
            startForegroundNotification()
            startProactivePolling()
            startHeartbeat()
            LogManager.i("봇 서비스 시작")
        } catch (e: Exception) {
            // 서비스 시작 실패 시 botEnabled 리셋
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
        proactiveTimer?.cancel()
        proactiveTimer = null
        heartbeatTimer?.cancel()
        heartbeatTimer = null
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
        heartbeatTimer?.cancel()
        heartbeatTimer = Timer("heartbeat")

        heartbeatTimer?.schedule(object : TimerTask() {
            override fun run() {
                try {
                    val registered = ApiClient.registerDevice()
                    if (registered) {
                        LogManager.d("기기 등록 완료: ${App.prefs.deviceId}")
                    }
                } catch (e: Exception) {
                    LogManager.e("기기 등록 오류: ${e.message}")
                }
            }
        }, 1000)

        heartbeatTimer?.scheduleAtFixedRate(object : TimerTask() {
            override fun run() {
                try {
                    ApiClient.sendHeartbeat()
                } catch (_: Exception) {}
            }
        }, HEARTBEAT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS)
    }

    private fun startProactivePolling() {
        proactiveTimer?.cancel()
        proactiveTimer = Timer("proactive-poll")
        proactiveTimer?.scheduleAtFixedRate(object : TimerTask() {
            override fun run() {
                try {
                    if (!App.prefs.botEnabled) return
                    val messages = ApiClient.fetchPendingProactive()
                    if (messages.isEmpty()) return

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
            }
        }, App.prefs.proactivePollMs, App.prefs.proactivePollMs)
    }
}
