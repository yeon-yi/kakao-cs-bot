package com.csbot.app

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.google.gson.reflect.TypeToken
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * API 서버 통신 클라이언트
 */
class ApiClient(private val prefs: BotPreferences) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)  // AI 처리 시간 고려
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    data class MessageRequest(
        val roomId: String,
        val userName: String,
        val message: String,
        val isGroupChat: Boolean,
    )

    data class MessageResponse(
        val answer: String?,
        val delay: Int?,
        val escalated: Boolean?,
        val category: String?,
        val confidence: Double?,
        val processingMs: Int?,
        val reason: String?,
        val error: String?,
    )

    data class StatusResponse(
        val status: String?,
        val operatingHours: Boolean?,
        val timestamp: String?,
    )

    data class ProactiveMessage(
        val id: Int,
        @SerializedName("room_id")
        val roomId: String,
        val message: String,
        @SerializedName("message_type")
        val messageType: String?,
        @SerializedName("user_name")
        val userName: String?,
    )

    data class ProactiveResponse(
        val messages: List<ProactiveMessage>?,
        val error: String?,
    )

    /**
     * 메시지 전송 → AI 답변 수신
     */
    fun sendMessage(
        roomId: String,
        userName: String,
        message: String,
        isGroupChat: Boolean,
        callback: (MessageResponse?) -> Unit
    ) {
        val body = gson.toJson(MessageRequest(roomId, userName, message, isGroupChat))
            .toRequestBody(jsonType)

        val request = Request.Builder()
            .url("${prefs.apiUrl}/webhook/message")
            .header("X-API-Key", prefs.apiKey)
            .header("Content-Type", "application/json")
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                callback(null)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val json = response.body?.string() ?: ""
                    val result = gson.fromJson(json, MessageResponse::class.java)
                    callback(result)
                } catch (e: Exception) {
                    callback(null)
                }
            }
        })
    }

    /**
     * 서버 상태 확인
     */
    fun checkStatus(callback: (StatusResponse?) -> Unit) {
        val request = Request.Builder()
            .url("${prefs.apiUrl}/webhook/status?key=${prefs.apiKey}")
            .get()
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                callback(null)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val json = response.body?.string() ?: ""
                    val result = gson.fromJson(json, StatusResponse::class.java)
                    callback(result)
                } catch (e: Exception) {
                    callback(null)
                }
            }
        })
    }

    /**
     * 대기중인 프로액티브(인사) 메시지 조회
     */
    fun getProactiveMessages(callback: (List<ProactiveMessage>?) -> Unit) {
        val request = Request.Builder()
            .url("${prefs.apiUrl}/webhook/proactive/pending?key=${prefs.apiKey}&limit=5")
            .header("X-API-Key", prefs.apiKey)
            .get()
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                callback(null)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val json = response.body?.string() ?: ""
                    val result = gson.fromJson(json, ProactiveResponse::class.java)
                    callback(result.messages)
                } catch (e: Exception) {
                    callback(null)
                }
            }
        })
    }

    /**
     * 프로액티브 메시지 전송 결과 보고
     */
    fun reportProactive(
        id: Int,
        status: String,
        error: String?,
        callback: (Boolean) -> Unit
    ) {
        val bodyMap = mutableMapOf<String, Any>(
            "id" to id,
            "status" to status,
        )
        if (error != null) bodyMap["error"] = error

        val body = gson.toJson(bodyMap).toRequestBody(jsonType)

        val request = Request.Builder()
            .url("${prefs.apiUrl}/webhook/proactive/report")
            .header("X-API-Key", prefs.apiKey)
            .header("Content-Type", "application/json")
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                callback(false)
            }

            override fun onResponse(call: Call, response: Response) {
                callback(response.isSuccessful)
            }
        })
    }
}
