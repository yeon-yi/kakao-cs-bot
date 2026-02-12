package com.csbot.app

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.text.SimpleDateFormat
import java.util.*

/**
 * 카카오톡 알림 수신 → API 호출 → 자동 답장
 *
 * NotificationListenerService는 안드로이드 공식 API로,
 * 카카오톡 앱을 직접 조작하지 않고 알림만 읽습니다.
 */
class NotificationService : NotificationListenerService() {

    private lateinit var prefs: BotPreferences
    private lateinit var apiClient: ApiClient

    // 방별 마지막 응답 시간 (rate limiting)
    private val lastResponseMap = mutableMapOf<String, Long>()

    // 최근 로그 (UI 표시용)
    private val recentLogs = mutableListOf<String>()

    // 연속 에러 카운트
    private var errorCount = 0

    companion object {
        private const val TAG = "CSBot"
        private const val KAKAO_PACKAGE = "com.kakao.talk"
        private const val MAX_ERRORS = 5
        private const val ERROR_PAUSE_MS = 300_000L  // 5분

        // 싱글톤 참조 (UI에서 접근용)
        var instance: NotificationService? = null
            private set

        fun getRecentLogs(): List<String> = instance?.recentLogs?.toList() ?: emptyList()
    }

    override fun onCreate() {
        super.onCreate()
        prefs = BotPreferences(this)
        apiClient = ApiClient(prefs)
        instance = this
        addLog("서비스 시작")
    }

    override fun onDestroy() {
        instance = null
        addLog("서비스 종료")
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // 카카오톡 알림만 처리
        if (sbn.packageName != KAKAO_PACKAGE) return

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
