package com.csbot.kakao

import android.content.Context
import android.content.SharedPreferences

class Prefs(context: Context) {

    private val sp: SharedPreferences =
        context.getSharedPreferences("csbot_prefs", Context.MODE_PRIVATE)

    var botEnabled: Boolean
        get() = sp.getBoolean("bot_enabled", true)
        set(v) = sp.edit().putBoolean("bot_enabled", v).apply()

    var apiUrl: String
        get() = sp.getString("api_url", "http://1.234.83.118:3000") ?: "http://1.234.83.118:3000"
        set(v) = sp.edit().putString("api_url", v).apply()

    var apiKey: String
        get() = sp.getString("api_key", "csbot-webhook-2026!secret") ?: ""
        set(v) = sp.edit().putString("api_key", v).apply()

    var opStartHour: Int
        get() = sp.getInt("op_start_hour", 9)
        set(v) = sp.edit().putInt("op_start_hour", v).apply()

    var opStartMin: Int
        get() = sp.getInt("op_start_min", 50)
        set(v) = sp.edit().putInt("op_start_min", v).apply()

    var opEndHour: Int
        get() = sp.getInt("op_end_hour", 18)
        set(v) = sp.edit().putInt("op_end_hour", v).apply()

    var opEndMin: Int
        get() = sp.getInt("op_end_min", 30)
        set(v) = sp.edit().putInt("op_end_min", v).apply()

    var roomCooldownMs: Long
        get() = sp.getLong("room_cooldown", 5000L)
        set(v) = sp.edit().putLong("room_cooldown", v).apply()

    var proactivePollMs: Long
        get() = sp.getLong("proactive_poll", 180000L)
        set(v) = sp.edit().putLong("proactive_poll", v).apply()

    var adminNames: Set<String>
        get() = sp.getStringSet("admin_names", emptySet()) ?: emptySet()
        set(v) = sp.edit().putStringSet("admin_names", v).apply()

    var allowedRooms: Set<String>
        get() = sp.getStringSet("allowed_rooms", emptySet()) ?: emptySet()
        set(v) = sp.edit().putStringSet("allowed_rooms", v).apply()
}
