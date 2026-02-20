package com.csbot.kakao

import android.os.Handler
import android.os.Looper
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

object LogManager {

    data class LogEntry(val time: String, val level: String, val message: String)

    private val logs = CopyOnWriteArrayList<LogEntry>()
    private val listeners = mutableListOf<() -> Unit>()
    private val handler = Handler(Looper.getMainLooper())
    private val sdf = SimpleDateFormat("HH:mm:ss", Locale.KOREA)
    private const val MAX_LOGS = 200

    var totalMessages = 0
        private set
    var totalResponses = 0
        private set
    var totalErrors = 0
        private set

    fun getAll(): List<LogEntry> = logs.toList()

    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    private fun add(level: String, message: String) {
        val entry = LogEntry(sdf.format(Date()), level, message)
        logs.add(entry)
        if (logs.size > MAX_LOGS) {
            logs.removeAt(0)
        }
        handler.post { listeners.forEach { it() } }
    }

    fun i(msg: String) {
        add("INFO", msg)
        android.util.Log.i("CSBot", msg)
    }

    fun d(msg: String) {
        add("DEBUG", msg)
        android.util.Log.d("CSBot", msg)
    }

    fun e(msg: String) {
        add("ERROR", msg)
        totalErrors++
        android.util.Log.e("CSBot", msg)
    }

    fun message() {
        totalMessages++
    }

    fun response() {
        totalResponses++
    }

    fun clear() {
        logs.clear()
        handler.post { listeners.forEach { it() } }
    }
}
