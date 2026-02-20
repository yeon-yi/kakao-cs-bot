package com.csbot.kakao

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            if (App.prefs.botEnabled) {
                val serviceIntent = Intent(context, BotService::class.java)
                context.startForegroundService(serviceIntent)
            }
        }
    }
}
