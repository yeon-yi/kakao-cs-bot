package com.csbot.kakao

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputEditText
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var switchBot: SwitchMaterial
    private lateinit var tvStatus: TextView
    private lateinit var tvServerStatus: TextView
    private lateinit var tvListenerStatus: TextView
    private lateinit var tvStats: TextView
    private lateinit var tvApiUrl: TextView
    private lateinit var rvLogs: RecyclerView
    private lateinit var logAdapter: LogAdapter

    private val bgExecutor = Executors.newSingleThreadExecutor()
    private val logListener = { runOnUiThread { refreshUI() } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 이전 크래시 로그가 있으면 먼저 표시 (레이아웃 없이)
        val crashSp = getSharedPreferences("crash_log", MODE_PRIVATE)
        val prevCrash = crashSp.getString("last_crash", null)
        if (prevCrash != null) {
            crashSp.edit().clear().apply()
            val tv = TextView(this).apply {
                text = "이전 크래시 로그:\n\n$prevCrash"
                setPadding(48, 48, 48, 48)
                textSize = 12f
                setTextIsSelectable(true)
            }
            setContentView(android.widget.ScrollView(this).apply { addView(tv) })
            return  // 크래시 로그만 보여주고 종료
        }

        try {
            initMainLayout()
        } catch (e: Exception) {
            // 레이아웃 inflation 실패 시 에러 표시
            val tv = TextView(this).apply {
                text = "앱 초기화 실패:\n\n${e.javaClass.simpleName}: ${e.message}\n\n${e.stackTraceToString()}"
                setPadding(48, 48, 48, 48)
                textSize = 12f
                setTextIsSelectable(true)
            }
            setContentView(android.widget.ScrollView(this).apply { addView(tv) })
        }
    }

    private fun initMainLayout() {
        setContentView(R.layout.activity_main)

        switchBot = findViewById(R.id.switchBot)
        tvStatus = findViewById(R.id.tvStatus)
        tvServerStatus = findViewById(R.id.tvServerStatus)
        tvListenerStatus = findViewById(R.id.tvListenerStatus)
        tvStats = findViewById(R.id.tvStats)
        tvApiUrl = findViewById(R.id.tvApiUrl)
        rvLogs = findViewById(R.id.rvLogs)

        // Log RecyclerView
        logAdapter = LogAdapter()
        rvLogs.layoutManager = LinearLayoutManager(this).apply { stackFromEnd = true }
        rvLogs.adapter = logAdapter

        // Bot toggle
        switchBot.isChecked = App.prefs.botEnabled
        switchBot.setOnCheckedChangeListener { _, isChecked ->
            App.prefs.botEnabled = isChecked
            updateServiceState(isChecked)
            refreshUI()
        }

        // Settings button
        findViewById<MaterialButton>(R.id.btnSettings).setOnClickListener { showSettingsDialog() }

        // Permission button
        findViewById<MaterialButton>(R.id.btnPermission).setOnClickListener { openNotificationAccess() }

        // Status check button
        findViewById<MaterialButton>(R.id.btnCheckStatus).setOnClickListener { checkServerStatus() }

        // Clear log button
        findViewById<MaterialButton>(R.id.btnClearLog).setOnClickListener {
            LogManager.clear()
            refreshUI()
        }

        // 서비스 자동 시작 안함 - 사용자가 직접 스위치 ON

        refreshUI()
    }

    override fun onResume() {
        super.onResume()
        LogManager.addListener(logListener)
        refreshUI()
    }

    override fun onPause() {
        super.onPause()
        LogManager.removeListener(logListener)
    }

    private fun refreshUI() {
        val prefs = App.prefs
        val enabled = prefs.botEnabled
        val listenerOk = isNotificationListenerEnabled()

        tvStatus.text = when {
            !enabled -> "비활성화"
            !listenerOk -> "알림 권한 필요"
            BotService.isRunning -> "작동 중"
            else -> "서비스 시작 필요"
        }

        tvStatus.setTextColor(getColor(when {
            !enabled -> android.R.color.holo_red_light
            listenerOk && BotService.isRunning -> android.R.color.holo_green_dark
            else -> android.R.color.holo_orange_dark
        }))

        tvListenerStatus.text = if (listenerOk) "연결됨" else "미연결 (권한 필요)"
        tvListenerStatus.setTextColor(getColor(
            if (listenerOk) android.R.color.holo_green_dark else android.R.color.holo_red_light
        ))

        tvApiUrl.text = prefs.apiUrl
        tvStats.text = "메시지: ${LogManager.totalMessages}  응답: ${LogManager.totalResponses}  에러: ${LogManager.totalErrors}"

        logAdapter.update(LogManager.getAll())
        if (logAdapter.itemCount > 0) {
            rvLogs.scrollToPosition(logAdapter.itemCount - 1)
        }
    }

    private fun checkServerStatus() {
        tvServerStatus.text = "확인 중..."
        bgExecutor.execute {
            val status = ApiClient.checkStatus()
            runOnUiThread {
                if (status != null) {
                    tvServerStatus.text = "${status.status} | 운영시간: ${if (status.operatingHours) "운영 중" else "운영 외"}"
                    tvServerStatus.setTextColor(getColor(android.R.color.holo_green_dark))
                } else {
                    tvServerStatus.text = "연결 실패"
                    tvServerStatus.setTextColor(getColor(android.R.color.holo_red_light))
                }
            }
        }
    }

    private fun updateServiceState(enabled: Boolean) {
        try {
            val intent = Intent(this, BotService::class.java)
            if (enabled) {
                startForegroundService(intent)
            } else {
                stopService(intent)
            }
        } catch (e: Exception) {
            LogManager.e("서비스 시작/중지 실패: ${e.message}")
        }
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val cn = ComponentName(this, NotificationListener::class.java)
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return flat?.contains(cn.flattenToString()) == true
    }

    private fun openNotificationAccess() {
        startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    private fun showSettingsDialog() {
        val prefs = App.prefs
        val etApiUrl = TextInputEditText(this).apply {
            setText(prefs.apiUrl)
            hint = "API URL"
        }
        val etApiKey = TextInputEditText(this).apply {
            setText(prefs.apiKey)
            hint = "API Key"
        }

        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 32, 48, 16)
            addView(TextView(context).apply { text = "API URL" })
            addView(etApiUrl)
            addView(TextView(context).apply {
                text = "\nAPI Key"
                setPadding(0, 16, 0, 0)
            })
            addView(etApiKey)
        }

        AlertDialog.Builder(this)
            .setTitle("설정")
            .setView(layout)
            .setPositiveButton("저장") { _, _ ->
                val url = etApiUrl.text?.toString()?.trim()
                val key = etApiKey.text?.toString()?.trim()
                if (!url.isNullOrEmpty()) prefs.apiUrl = url
                if (!key.isNullOrEmpty()) prefs.apiKey = key
                refreshUI()
                LogManager.i("설정 저장됨: $url")
            }
            .setNegativeButton("취소", null)
            .show()
    }

    // Log adapter
    class LogAdapter : RecyclerView.Adapter<LogAdapter.VH>() {
        private var items = listOf<LogManager.LogEntry>()

        fun update(newItems: List<LogManager.LogEntry>) {
            items = newItems
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val tv = TextView(parent.context).apply {
                textSize = 11f
                setPadding(16, 4, 16, 4)
                setTextIsSelectable(true)
            }
            return VH(tv)
        }

        override fun onBindViewHolder(holder: VH, position: Int) {
            val item = items[position]
            val color = when (item.level) {
                "ERROR" -> "#EF4444"
                "INFO" -> "#2563EB"
                else -> "#6B7280"
            }
            holder.tv.text = "${item.time} [${item.level}] ${item.message}"
            holder.tv.setTextColor(android.graphics.Color.parseColor(color))
        }

        override fun getItemCount() = items.size

        class VH(val tv: TextView) : RecyclerView.ViewHolder(tv)
    }
}
