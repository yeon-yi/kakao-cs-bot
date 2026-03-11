package com.csbot.kakao

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import java.util.concurrent.ConcurrentHashMap

class NotificationListener : NotificationListenerService() {

    companion object {
        val replyActions = ConcurrentHashMap<String, ReplySession>()
        var isConnected = false
            private set
    }

    data class ReplySession(
        val action: Notification.Action,
        val timestamp: Long
    )

    override fun onListenerConnected() {
        super.onListenerConnected()
        isConnected = true
        LogManager.i("알림 리스너 연결됨")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isConnected = false
        LogManager.i("알림 리스너 연결 해제")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName != "com.kakao.talk") return
        if (!App.prefs.botEnabled) return

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        // Find reply action
        val replyAction = notification.actions?.firstOrNull { action ->
            action.remoteInputs?.isNotEmpty() == true
        } ?: return

        // Extract message info
        val info = extractInfo(notification, extras)
        if (info.room == null || info.message == null) return

        // Store reply action for ALL rooms (proactive/staff notifications need this)
        replyActions[info.room] = ReplySession(replyAction, System.currentTimeMillis())

        // Allowed rooms filter (only for bot auto-reply, not proactive)
        val allowed = App.prefs.allowedRooms
        if (allowed.isNotEmpty() && !allowed.contains(info.room)) return

        // Delegate to bot engine
        BotEngine.handleMessage(
            room = info.room,
            sender = info.sender ?: "Unknown",
            message = info.message,
            isGroupChat = info.isGroupChat,
            replyAction = replyAction
        )
    }

    private fun extractInfo(notification: Notification, extras: android.os.Bundle): MessageInfo {
        // Try MessagingStyle (newer KakaoTalk versions)
        try {
            val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
            if (style != null) {
                val lastMsg = style.messages.lastOrNull()
                if (lastMsg != null) {
                    val sender = lastMsg.person?.name?.toString()
                    val text = lastMsg.text?.toString()
                    val isGroup = style.isGroupConversation
                    val room = if (isGroup) {
                        style.conversationTitle?.toString()
                            ?: extras.getString(Notification.EXTRA_CONVERSATION_TITLE)
                            ?: extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()
                            ?: extras.getString(Notification.EXTRA_TITLE)
                    } else {
                        sender ?: extras.getString(Notification.EXTRA_TITLE)
                    }
                    return MessageInfo(room, sender, text, isGroup)
                }
            }
        } catch (_: Exception) {}

        // Fallback: basic notification parsing
        val title = extras.getString(Notification.EXTRA_TITLE)
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()
        val isGroup = subText != null

        return if (isGroup) {
            MessageInfo(room = subText, sender = title, message = text, isGroupChat = true)
        } else {
            MessageInfo(room = title, sender = title, message = text, isGroupChat = false)
        }
    }

    private data class MessageInfo(
        val room: String?,
        val sender: String?,
        val message: String?,
        val isGroupChat: Boolean
    )
}
