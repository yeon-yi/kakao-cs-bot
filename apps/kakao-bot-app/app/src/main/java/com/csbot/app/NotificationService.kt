package com.csbot.app

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ConcurrentHashMap

/**
 * 카카오톡 알림 수신 → API 호출 → 자동 답장
 * + 방별 reply action 캐싱 → 프로액티브 인사 메시지 전송
 *
 * NotificationListenerService는 안드로이드 공식 API로,
 * 카카오톡 앱을 직접 조작하지 않고 알림만 읽습니다.
 */
class NotificationService : NotificationListenerService() {

    private lateinit var prefs: BotPreferences
    private lateinit var apiClient: ApiClient

    // 방별 마지막 응답 시간 (rate limiting)
    private val lastResponseMap = mutableMapOf<String, Long>()

    // 방별 reply action 캐시 (프로액티브 메시징용)
    private val replyActionCache = ConcurrentHashMap<String, CachedReplyAction>()

    // 최근 로그 (UI 표시용)
    private val recentLogs = mutableListOf<String>()

    // 연속 에러 카운트
    private var errorCount = 0

    // 프로액티브 메시지 폴링 핸들러
    private val proactiveHandler = Handler(Looper.getMainLooper())
    private val proactivePollRunnable = object : Runnable {
        override fun run() {
            if (prefs.botEnabled && prefs.proactiveEnabled) {
                pollProactiveMessages()
            }
            // 10분마다 폴링
            proactiveHandler.postDelayed(this, PROACTIVE_POLL_INTERVAL)
        }
    }

    data class CachedReplyAction(
        val action: Notification.Action,
        val cachedAt: Long,
        val roomName: String,
    )

    companion object {
        private const val TAG = "CSBot"
        private const val KAKAO_PACKAGE = "com.kakao.talk"
        private const val MAX_ERRORS = 5
        private const val ERROR_PAUSE_MS = 300_000L  // 5분
        private const val REPLY_CACHE_TTL = 24 * 60 * 60 * 1000L  // 24시간
        private const val PROACTIVE_POLL_INTERVAL = 10 * 60 * 1000L  // 10분

        // 싱글톤 참조 (UI에서 접근용)
        var instance: NotificationService? = null
            private set

        fun getRecentLogs(): List<String> = instance?.recentLogs?.toList() ?: emptyList()
        fun getCachedRoomCount(): Int = instance?.replyActionCache?.size ?: 0
    }

    override fun onCreate() {
        super.onCreate()
        prefs = BotPreferences(this)
        apiClient = ApiClient(prefs)
        instance = this
        addLog("서비스 시작")

        // 프로액티브 폴링 시작
        proactiveHandler.postDelayed(proactivePollRunnable, 60_000) // 1분 후 시작
    }

    override fun onDestroy() {
        proactiveHandler.removeCallbacks(proactivePollRunnable)
        instance = null
        addLog("서비스 종료")
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // 카카오톡 알림만 처리
        if (sbn.packageName != KAKAO_PACKAGE) return

        // 알림에서 reply action 추출 및 캐싱 (봇 비활성 상태에서도)
        cacheReplyAction(sbn)

        // 봇 비활성화 상태
        if (!prefs.botEnabled) return

        // 연속 에러 시 일시 중지
        if (errorCount >= MAX_ERRORS) {
            return
        }

        try {
            processNotification(sbn)
        } catch (e: Exception) {
            Log.e(TAG, "알림 처리 실패", e)
            errorCount++
        }
    }

    /**
     * 알림에서 reply action을 추출하여 방별로 캐싱
     * (프로액티브 메시지 전송에 필요)
     */
    private fun cacheReplyAction(sbn: StatusBarNotification) {
        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return
        val sender = extras.getString(Notification.EXTRA_TITLE) ?: return
        val isGroupChat = extras.getCharSequence(Notification.EXTRA_SUB_TEXT) != null
        val roomId = if (isGroupChat) {
            extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: sender
        } else {
            sender
        }

        val replyAction = findReplyAction(notification) ?: return

        replyActionCache[roomId] = CachedReplyAction(
            action = replyAction,
            cachedAt = System.currentTimeMillis(),
            roomName = roomId,
        )

        // 오래된 캐시 정리
        cleanExpiredCache()
    }

    private fun cleanExpiredCache() {
        val now = System.currentTimeMillis()
        replyActionCache.entries.removeIf { (_, cached) ->
            now - cached.cachedAt > REPLY_CACHE_TTL
        }
    }

    private fun processNotification(sbn: StatusBarNotification) {
        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        // 메시지 정보 추출
        val sender = extras.getString(Notification.EXTRA_TITLE) ?: return
        val message = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: return
        val isGroupChat = extras.getCharSequence(Notification.EXTRA_SUB_TEXT) != null
        val roomId = if (isGroupChat) {
            extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: sender
        } else {
            sender
        }

        // 답장 액션 추출 (WearableExtender)
        val replyAction = findReplyAction(notification) ?: return

        // 짧은 메시지 / 단순 반응 무시
        if (shouldSkip(message)) return

        // 평일 체크
        if (prefs.weekdayOnly && !isWeekday()) return

        // Rate limiting
        val lastTime = lastResponseMap[roomId] ?: 0
        if (System.currentTimeMillis() - lastTime < prefs.roomCooldown) return

        // API 호출
        addLog("[$roomId] $sender: ${message.take(30)}...")

        apiClient.sendMessage(roomId, sender, message, isGroupChat) { response ->
            if (response == null) {
                errorCount++
                prefs.totalErrors++
                addLog("[$roomId] API 오류 (연속 $errorCount 회)")
                return@sendMessage
            }

            // 에러 카운트 리셋
            errorCount = 0

            // 차단된 방이면 무시
            if (response.reason == "room_blocked") {
                addLog("[$roomId] 차단된 방 (응답 안함)")
                return@sendMessage
            }

            // 응답 없음 (운영시간 외, rate limit 등)
            val answer = response.answer ?: return@sendMessage

            // 인간다운 딜레이
            val serverDelay = response.delay ?: 3000
            val extraDelay = (500..2000).random()
            val totalDelay = serverDelay + extraDelay

            Thread {
                try {
                    Thread.sleep(totalDelay.toLong())

                    // 답장 전송
                    sendReply(replyAction, answer)

                    // 상태 업데이트
                    lastResponseMap[roomId] = System.currentTimeMillis()
                    if (response.escalated == true) {
                        prefs.totalEscalations++
                        addLog("[$roomId] → 에스컬레이션 (유사도 ${((response.confidence ?: 0.0) * 100).toInt()}%)")
                    } else {
                        prefs.totalResponses++
                        addLog("[$roomId] → 응답 완료 (${response.processingMs}ms + ${totalDelay}ms)")
                    }

                    // UI 업데이트 알림
                    sendBroadcast(Intent("com.csbot.app.STATUS_UPDATE"))

                } catch (e: Exception) {
                    Log.e(TAG, "답장 전송 실패", e)
                    prefs.totalErrors++
                }
            }.start()
        }
    }

    // ===================== 프로액티브 메시징 =====================

    /**
     * API 서버에서 대기중인 인사 메시지를 폴링하여 전송
     */
    private fun pollProactiveMessages() {
        if (replyActionCache.isEmpty()) {
            return  // 캐시된 reply action 없으면 전송 불가
        }

        apiClient.getProactiveMessages { messages ->
            if (messages.isNullOrEmpty()) return@getProactiveMessages

            addLog("[인사] ${messages.size}건 대기 메시지 발견")

            for (msg in messages) {
                val cached = replyActionCache[msg.roomId]
                if (cached == null) {
                    addLog("[인사] ${msg.roomId} - 캐시된 답장 없음 (skip)")
                    apiClient.reportProactive(msg.id, "failed", "no_cached_reply") {}
                    continue
                }

                // 만료된 캐시 체크
                if (System.currentTimeMillis() - cached.cachedAt > REPLY_CACHE_TTL) {
                    replyActionCache.remove(msg.roomId)
                    addLog("[인사] ${msg.roomId} - 캐시 만료 (skip)")
                    apiClient.reportProactive(msg.id, "failed", "cache_expired") {}
                    continue
                }

                // 인간다운 딜레이 후 전송
                Thread {
                    try {
                        val delay = (3000..8000).random()
                        Thread.sleep(delay.toLong())

                        sendReply(cached.action, msg.message)
                        prefs.totalProactivesSent++
                        addLog("[인사] ${msg.roomId} → 전송 완료")

                        // 성공 보고
                        apiClient.reportProactive(msg.id, "sent", null) {}

                        // 다음 메시지까지 간격
                        Thread.sleep((5000..15000).random().toLong())

                    } catch (e: Exception) {
                        Log.e(TAG, "인사 전송 실패: ${msg.roomId}", e)
                        apiClient.reportProactive(msg.id, "failed", e.message) {}
                    }

                    sendBroadcast(Intent("com.csbot.app.STATUS_UPDATE"))
                }.start()
            }
        }
    }

    /**
     * WearableExtender에서 답장 액션 찾기
     * (스마트워치 답장 기능을 이용한 비침습적 답장)
     */
    private fun findReplyAction(notification: Notification): Notification.Action? {
        // WearableExtender에서 찾기
        val wearableExtender = Notification.WearableExtender(notification)
        for (action in wearableExtender.actions) {
            if (action.remoteInputs?.isNotEmpty() == true) {
                return action
            }
        }

        // 일반 액션에서 찾기 (fallback)
        notification.actions?.forEach { action ->
            if (action.remoteInputs?.isNotEmpty() == true) {
                return action
            }
        }

        return null
    }

    /**
     * 답장 전송
     */
    private fun sendReply(action: Notification.Action, text: String) {
        val intent = Intent()
        val bundle = Bundle()

        action.remoteInputs?.forEach { remoteInput ->
            bundle.putCharSequence(remoteInput.resultKey, text)
        }

        RemoteInput.addResultsToIntent(action.remoteInputs, intent, bundle)
        action.actionIntent.send(this, 0, intent)
    }

    /**
     * 무시할 메시지 판별
     */
    private fun shouldSkip(msg: String): Boolean {
        if (msg.length < 2) return true
        if (msg.matches(Regex("^[ㅋㅎㅠㅜㅇ]+$"))) return true
        if (msg in listOf("ㅇㅇ", "ㅇㅋ", "ㅎㅇ", "ㄴㄴ", "ㄱㄱ", "ㄱㅅ", "ㅎ")) return true
        if (msg in listOf("사진", "동영상", "이모티콘", "파일")) return true
        return false
    }

    private fun isWeekday(): Boolean {
        val day = Calendar.getInstance().get(Calendar.DAY_OF_WEEK)
        return day in Calendar.MONDAY..Calendar.FRIDAY
    }

    private fun addLog(message: String) {
        val time = SimpleDateFormat("HH:mm:ss", Locale.KOREA).format(Date())
        val log = "[$time] $message"
        synchronized(recentLogs) {
            recentLogs.add(0, log)
            if (recentLogs.size > 100) recentLogs.removeAt(recentLogs.lastIndex)
        }
        Log.d(TAG, log)
    }
}
