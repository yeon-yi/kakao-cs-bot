package com.csbot.app

import android.content.Context
import android.content.SharedPreferences

/**
 * 봇 설정 관리 (SharedPreferences 기반)
 */
class BotPreferences(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("csbot_prefs", Context.MODE_PRIVATE)

    var apiUrl: String
        get() = prefs.getString("api_url", DEFAULT_API_URL) ?: DEFAULT_API_URL
        set(value) = prefs.edit().putString("api_url", value).apply()

    var apiKey: String
        get() = prefs.getString("api_key", DEFAULT_API_KEY) ?: DEFAULT_API_KEY
        set(value) = prefs.edit().putString("api_key", value).apply()

    var botEnabled: Boolean
        get() = prefs.getBoolean("bot_enabled", false)
        set(value) = prefs.edit().putBoolean("bot_enabled", value).apply()

    var minDelay: Int
        get() = prefs.getInt("min_delay", 3000)
        set(value) = prefs.edit().putInt("min_delay", value).apply()

    var maxDelay: Int
        get() = prefs.getInt("max_delay", 8000)
        set(value) = prefs.edit().putInt("max_delay", value).apply()

    var roomCooldown: Int
        get() = prefs.getInt("room_cooldown", 5000)
        set(value) = prefs.edit().putInt("room_cooldown", value).apply()

    var weekdayOnly: Boolean
        get() = prefs.getBoolean("weekday_only", true)
        set(value) = prefs.edit().putBoolean("weekday_only", value).apply()

    // 통계
    var totalResponses: Int
        get() = prefs.getInt("total_responses", 0)
        set(value) = prefs.edit().putInt("total_responses", value).apply()

    var totalEscalations: Int
        get() = prefs.getInt("total_escalations", 0)
        set(value) = prefs.edit().putInt("total_escalations", value).apply()

    var totalErrors: Int
        get() = prefs.getInt("total_errors", 0)
        set(value) = prefs.edit().putInt("total_errors", value).apply()

    fun resetStats() {
        totalResponses = 0
        totalEscalations = 0
        totalErrors = 0
    }

    companion object {
        const val DEFAULT_API_URL = "https://carefree-analysis-production-7389.up.railway.app"
        const val DEFAULT_API_KEY = "csbot-webhook-2026!secret"
    }
}
