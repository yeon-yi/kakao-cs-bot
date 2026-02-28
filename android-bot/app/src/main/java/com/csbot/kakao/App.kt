package com.csbot.kakao

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class App : Application() {

    companion object {
        lateinit var prefs: Prefs
            private set
        lateinit var instance: App
            private set
    }

    override fun onCreate() {
        super.onCreate()

        // 크래시 핸들러를 가장 먼저 설정 (다른 코드보다 앞에)
        val defaultHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val log = "CRASH: ${throwable.javaClass.simpleName}: ${throwable.message}\n${throwable.stackTraceToString()}"
                // SharedPreferences (동기 commit)
                applicationContext.getSharedPreferences("crash_log", MODE_PRIVATE)
                    .edit()
                    .putString("last_crash", log)
                    .commit()
                // 크래시 시 봇 자동 비활성화 (재시작 루프 방지)
                applicationContext.getSharedPreferences("csbot_prefs", MODE_PRIVATE)
                    .edit()
                    .putBoolean("bot_enabled", false)
                    .commit()
                // 내부 파일에도 백업
                java.io.File(filesDir, "crash.txt").writeText(log)
            } catch (_: Exception) {}
            defaultHandler?.uncaughtException(thread, throwable)
        }

        try {
            instance = this
            prefs = Prefs(this)
            createNotificationChannels()
        } catch (e: Exception) {
            android.util.Log.e("CSBot", "App init failed", e)
        }
    }

    private fun createNotificationChannels() {
        val manager = getSystemService(NotificationManager::class.java)

        val serviceChannel = NotificationChannel(
            "bot_service",
            "CS봇 서비스",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "봇 백그라운드 서비스 알림"
            setShowBadge(false)
        }

        val logChannel = NotificationChannel(
            "bot_log",
            "CS봇 로그",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "봇 동작 로그 알림"
        }

        manager.createNotificationChannel(serviceChannel)
        manager.createNotificationChannel(logChannel)
    }
}
