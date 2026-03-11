package com.csbot.kakao

import android.os.Handler
import android.os.Looper
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

object LogManager {

    data class LogEntry(val time: String, val level: String, val message: String)

    private val logs = CopyOnWriteArrayList<LogEntry>()
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val handler = Handler(Looper.getMainLooper())
    private val sdfLocal = ThreadLocal.withInitial {
        SimpleDateFormat("HH:mm:ss", Locale.KOREA)
    }
    private const val MAX_LOGS = 200

    private val _totalMessages = AtomicInteger(0)
    private val _totalResponses = AtomicInteger(0)
    private val _totalErrors = AtomicInteger(0)

    val totalMessages: Int get() = _totalMessages.get()
    val totalResponses: Int get() = _totalResponses.get()
    val totalErrors: Int get() = _totalErrors.get()

    fun getAll(): List<LogEntry> = logs.toList()

    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    private fun add(level: String, message: String) {
        val entry = LogEntry(sdfLocal.get()!!.format(Date()), level, message)
        logs.add(entry)
        while (logs.size > MAX_LOGS) {
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
        _totalErrors.incrementAndGet()
        android.util.Log.e("CSBot", msg)
    }

    fun message() {
        _totalMessages.incrementAndGet()
    }

    fun response() {
        _totalResponses.incrementAndGet()
    }

    fun clear() {
        logs.clear()
        handler.post { listeners.forEach { it() } }
    }
}
