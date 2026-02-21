package com.csbot.kakao

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object ApiClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

    private fun baseUrl() = App.prefs.apiUrl
    private fun apiKey() = App.prefs.apiKey

    data class MessageResult(
        val answer: String?,
        val delay: Long,
        val escalated: Boolean,
        val confidence: Double,
        val processingMs: Long,
        val reason: String?
    )

    fun sendMessage(roomId: String, userName: String, message: String, isGroupChat: Boolean, messageType: String = "text"): MessageResult? {
        return try {
            val body = JSONObject().apply {
                put("roomId", roomId)
                put("userName", userName)
                put("message", message)
                put("isGroupChat", isGroupChat)
                if (messageType != "text") put("messageType", messageType)
            }

            val request = Request.Builder()
                .url("${baseUrl()}/webhook/message")
                .header("Content-Type", "application/json")
                .header("X-API-Key", apiKey())
                .post(body.toString().toRequestBody(JSON_TYPE))
                .build()

            val response = client.newCall(request).execute()
            if (response.code != 200) {
                LogManager.e("API HTTP ${response.code}")
                return null
            }

            val data = JSONObject(response.body?.string() ?: "{}")
            MessageResult(
                answer = data.optString("answer", null),
                delay = data.optLong("delay", 3000),
                escalated = data.optBoolean("escalated", false),
                confidence = data.optDouble("confidence", 0.0),
                processingMs = data.optLong("processingMs", 0),
                reason = data.optString("reason", null)
            )
        } catch (e: Exception) {
            LogManager.e("API 호출 실패: ${e.message}")
            null
        }
    }

    data class StatusResult(val status: String, val operatingHours: Boolean, val timestamp: String)

    fun checkStatus(): StatusResult? {
        return try {
            val request = Request.Builder()
                .url("${baseUrl()}/webhook/status")
                .header("X-API-Key", apiKey())
                .get()
                .build()

            val response = client.newCall(request).execute()
            if (response.code != 200) return null

            val data = JSONObject(response.body?.string() ?: "{}")
            StatusResult(
                status = data.optString("status", "unknown"),
                operatingHours = data.optBoolean("operatingHours", false),
                timestamp = data.optString("timestamp", "")
            )
        } catch (e: Exception) {
            LogManager.e("서버 상태 확인 실패: ${e.javaClass.simpleName} - ${e.message}")
            null
        }
    }

    data class ProactiveMessage(val id: Int, val roomId: String, val message: String)

    fun fetchPendingProactive(limit: Int = 5): List<ProactiveMessage> {
        return try {
            val request = Request.Builder()
                .url("${baseUrl()}/webhook/proactive/pending?limit=$limit")
                .header("X-API-Key", apiKey())
                .get()
                .build()

            val response = client.newCall(request).execute()
            if (response.code != 200) return emptyList()

            val data = JSONObject(response.body?.string() ?: "{}")
            val messages = data.optJSONArray("messages") ?: JSONArray()
            (0 until messages.length()).map { i ->
                val msg = messages.getJSONObject(i)
                ProactiveMessage(
                    id = msg.getInt("id"),
                    roomId = msg.getString("room_id"),
                    message = msg.getString("message")
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun reportProactive(id: Int, status: String, error: String? = null) {
        try {
            val body = JSONObject().apply {
                put("id", id)
                put("status", status)
                if (error != null) put("error", error)
            }

            val request = Request.Builder()
                .url("${baseUrl()}/webhook/proactive/report")
                .header("Content-Type", "application/json")
                .header("X-API-Key", apiKey())
                .post(body.toString().toRequestBody(JSON_TYPE))
                .build()

            client.newCall(request).execute().close()
        } catch (_: Exception) {}
    }

    // ===================== 기기 모니터링 =====================

    fun registerDevice(): Boolean {
        return try {
            val prefs = App.prefs
            val body = JSONObject().apply {
                put("deviceId", prefs.deviceId)
                put("deviceName", prefs.deviceName)
                put("deviceType", "android")
                put("appVersion", getAppVersion())
                put("osVersion", "Android ${android.os.Build.VERSION.RELEASE}")
            }

            val request = Request.Builder()
                .url("${baseUrl()}/webhook/device/register")
                .header("Content-Type", "application/json")
                .header("X-API-Key", apiKey())
                .post(body.toString().toRequestBody(JSON_TYPE))
                .build()

            val response = client.newCall(request).execute()
            response.code == 200
        } catch (e: Exception) {
            LogManager.e("기기 등록 실패: ${e.message}")
            false
        }
    }

    fun sendHeartbeat(error: String? = null): Boolean {
        return try {
            val prefs = App.prefs
            val body = JSONObject().apply {
                put("deviceId", prefs.deviceId)
                put("messagesTotal", LogManager.totalMessages)
                put("messagesToday", LogManager.totalResponses)
                if (error != null) put("error", error)
            }

            val request = Request.Builder()
                .url("${baseUrl()}/webhook/device/heartbeat")
                .header("Content-Type", "application/json")
                .header("X-API-Key", apiKey())
                .post(body.toString().toRequestBody(JSON_TYPE))
                .build()

            val response = client.newCall(request).execute()
            response.code == 200
        } catch (_: Exception) {
            false
        }
    }

    private fun getAppVersion(): String {
        return try {
            val pInfo = App.instance.packageManager.getPackageInfo(App.instance.packageName, 0)
            pInfo.versionName ?: "1.0"
        } catch (_: Exception) {
            "1.0"
        }
    }

    fun isRoomBlocked(roomId: String): Boolean {
        return try {
            val request = Request.Builder()
                .url("${baseUrl()}/webhook/blocks/check?roomId=${java.net.URLEncoder.encode(roomId, "UTF-8")}")
                .header("X-API-Key", apiKey())
                .get()
                .build()

            val response = client.newCall(request).execute()
            if (response.code == 200) {
                JSONObject(response.body?.string() ?: "{}").optBoolean("blocked", false)
            } else false
        } catch (_: Exception) {
            false
        }
    }
}
