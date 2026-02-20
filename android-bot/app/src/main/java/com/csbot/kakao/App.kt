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
        instance = this
        prefs = Prefs(this)
        createNotificationChannels()
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
