package com.csbot.kakao

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import java.util.Calendar
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

object BotEngine {

    private val executor = Executors.newFixedThreadPool(3)
    private val lastResponseTime = ConcurrentHashMap<String, Long>()
    private val blockedRooms = ConcurrentHashMap<String, Pair<Boolean, Long>>()
    private const val BLOCK_CACHE_TTL = 600_000L

    private var errorCount = 0
    private var errorPauseStart = 0L
    private const val MAX_ERRORS = 5
    private const val ERROR_PAUSE_MS = 300_000L

    private val SKIP_PATTERNS = listOf(
        Regex("^[ㅋㅎㅠㅜㅇ]+$"),
        Regex("^(ㅇㅇ|ㅇㅋ|ㅎㅇ|ㄴㄴ|ㄱㄱ|ㄱㅅ)$"),
        Regex("^[!?.,;:~·…\\s]+$")
    )
    private val SKIP_MESSAGES = setOf("이모티콘")
    private val MEDIA_MESSAGE_TYPES = mapOf("사진" to "image", "동영상" to "video")

    fun handleMessage(
        room: String,
        sender: String,
        message: String,
        isGroupChat: Boolean,
        replyAction: Notification.Action
    ) {
        val prefs = App.prefs

        // Admin commands
        if (message.startsWith("!") && prefs.adminNames.contains(sender)) {
            handleAdminCommand(message, replyAction)
            return
        }

        if (!prefs.botEnabled) return

        // Filter (운영시간/요일은 서버에서 판단 - 테스트 모드 지원)
        if (shouldSkip(message)) return
        if (isCooldown(room, prefs.roomCooldownMs)) return

        // Error pause
        if (errorCount >= MAX_ERRORS) {
            if (errorPauseStart == 0L) errorPauseStart = System.currentTimeMillis()
            if (System.currentTimeMillis() - errorPauseStart < ERROR_PAUSE_MS) return
            errorCount = 0
            errorPauseStart = 0
        }

        LogManager.message()

        executor.execute {
            try {
                // Block check
                val cached = blockedRooms[room]
                if (cached == null || System.currentTimeMillis() - cached.second > BLOCK_CACHE_TTL) {
                    val blocked = ApiClient.isRoomBlocked(room)
                    blockedRooms[room] = Pair(blocked, System.currentTimeMillis())
                    if (blocked) return@execute
                } else if (cached.first) return@execute

                val mediaType = MEDIA_MESSAGE_TYPES[message]
                val result = ApiClient.sendMessage(room, sender, message, isGroupChat, mediaType ?: "text")
                if (result == null) {
                    errorCount++
                    return@execute
                }

                errorCount = 0

                if (result.answer.isNullOrEmpty()) {
                    LogManager.d("$room | 응답 없음 (${result.reason ?: "unknown"})")
                    return@execute
                }

                // Delay
                val extraDelay = (500..2000).random().toLong()
                val totalDelay = result.delay + extraDelay
                Thread.sleep(totalDelay)

                // Reply
                sendReply(replyAction, result.answer)
                lastResponseTime[room] = System.currentTimeMillis()
                LogManager.response()

                val tag = if (result.escalated) "에스컬" else "응답"
                LogManager.i("$room | $sender [$tag] 유사도:${(result.confidence * 100).toInt()}% ${result.processingMs}ms 딜레이:${totalDelay}ms")

            } catch (e: Exception) {
                LogManager.e("처리 오류: ${e.message}")
                errorCount++
            }
        }
    }

    fun handleProactive(roomId: String, message: String): Boolean {
        val session = NotificationListener.replyActions[roomId] ?: return false
        // Check if action is not too old (30 min)
        if (System.currentTimeMillis() - session.timestamp > 1_800_000) {
            NotificationListener.replyActions.remove(roomId)
            return false
        }
        return try {
            Thread.sleep((2000..5000).random().toLong())
            sendReply(session.action, message)
            LogManager.i("프로액티브 전송: $roomId")
            true
        } catch (e: Exception) {
            LogManager.e("프로액티브 실패: $roomId - ${e.message}")
            false
        }
    }

    private fun sendReply(action: Notification.Action, message: String) {
        val inputs = action.remoteInputs ?: return
        val intent = Intent()
        val bundle = Bundle()
        for (ri in inputs) {
            bundle.putCharSequence(ri.resultKey, message)
        }
        RemoteInput.addResultsToIntent(inputs, intent, bundle)
        action.actionIntent.send(App.instance, 0, intent)
    }

    private fun handleAdminCommand(msg: String, replyAction: Notification.Action) {
        val response = when (msg) {
            "!봇상태" -> {
                val status = try { ApiClient.checkStatus() } catch (_: Exception) { null }
                buildString {
                    append("[CS봇 상태]\n")
                    append("활성: ${if (App.prefs.botEnabled) "켜짐" else "꺼짐"}\n")
                    append("운영시간: ${if (isOperatingHours()) "운영 중" else "운영 외"}\n")
                    append("에러: $errorCount/$MAX_ERRORS\n")
                    append("메시지: ${LogManager.totalMessages} / 응답: ${LogManager.totalResponses}\n")
                    if (status != null) {
                        append("서버: ${status.status}\n")
                        append("서버 운영시간: ${status.operatingHours}")
                    } else {
                        append("서버: 연결 실패")
                    }
                }
            }
            "!봇켜기" -> {
                App.prefs.botEnabled = true
                errorCount = 0
                "[CS봇] 봇이 활성화되었습니다."
            }
            "!봇끄기" -> {
                App.prefs.botEnabled = false
                "[CS봇] 봇이 비활성화되었습니다."
            }
            "!에러초기화" -> {
                errorCount = 0
                "[CS봇] 에러 카운트가 초기화되었습니다."
            }
            else -> return
        }

        executor.execute {
            try {
                sendReply(replyAction, response)
            } catch (e: Exception) {
                LogManager.e("관리 명령 응답 실패: ${e.message}")
            }
        }
    }

    private fun shouldSkip(msg: String): Boolean {
        if (msg.length < 2) return true
        if (SKIP_MESSAGES.contains(msg)) return true
        return SKIP_PATTERNS.any { it.matches(msg) }
    }

    private fun isCooldown(room: String, cooldownMs: Long): Boolean {
        val last = lastResponseTime[room] ?: return false
        return System.currentTimeMillis() - last < cooldownMs
    }

    private fun isOperatingHours(): Boolean {
        val prefs = App.prefs
        val cal = Calendar.getInstance()
        val current = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        val start = prefs.opStartHour * 60 + prefs.opStartMin
        val end = prefs.opEndHour * 60 + prefs.opEndMin
        return current in start..end
    }

    private fun isWeekday(): Boolean {
        val day = Calendar.getInstance().get(Calendar.DAY_OF_WEEK)
        return day in Calendar.MONDAY..Calendar.FRIDAY
    }
}
