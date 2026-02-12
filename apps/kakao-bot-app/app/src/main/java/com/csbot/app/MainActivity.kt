package com.csbot.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * CS봇 메인 화면
 * - 봇 ON/OFF 토글
 * - 서버 연결 상태
 * - 실시간 로그
 * - 통계
 */
class MainActivity : AppCompatActivity() {

    private lateinit var prefs: BotPreferences
    private lateinit var apiClient: ApiClient

    // UI
    private lateinit var toggleBot: Switch
    private lateinit var txtStatus: TextView
    private lateinit var txtServerStatus: TextView
    private lateinit var txtStats: TextView
    private lateinit var txtLogs: TextView
    private lateinit var btnCheckPermission: Button
    private lateinit var btnTestConnection: Button
    private lateinit var btnSettings: Button

    private val handler = Handler(Looper.getMainLooper())
    private val refreshRunnable = object : Runnable {
        override fun run() {
            refreshUI()
            handler.postDelayed(this, 3000)  // 3초마다 갱신
        }
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshUI()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = BotPreferences(this)
        apiClient = ApiClient(prefs)

        initViews()
        setupListeners()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(statusReceiver, IntentFilter("com.csbot.app.STATUS_UPDATE"), RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(statusReceiver, IntentFilter("com.csbot.app.STATUS_UPDATE"))
        }
    }

    override fun onResume() {
        super.onResume()
        handler.post(refreshRunnable)
        checkNotificationPermission()
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(refreshRunnable)
    }

    override fun onDestroy() {
        unregisterReceiver(statusReceiver)
        super.onDestroy()
    }

    private fun initViews() {
        toggleBot = findViewById(R.id.toggleBot)
        txtStatus = findViewById(R.id.txtStatus)
        txtServerStatus = findViewById(R.id.txtServerStatus)
        txtStats = findViewById(R.id.txtStats)
        txtLogs = findViewById(R.id.txtLogs)
        btnCheckPermission = findViewById(R.id.btnCheckPermission)
        btnTestConnection = findViewById(R.id.btnTestConnection)
        btnSettings = findViewById(R.id.btnSettings)

        toggleBot.isChecked = prefs.botEnabled
    }

    private fun setupListeners() {
        toggleBot.setOnCheckedChangeListener { _, isChecked ->
            prefs.botEnabled = isChecked
            refreshUI()
        }

        btnCheckPermission.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        btnTestConnection.setOnClickListener {
            txtServerStatus.text = "서버 확인 중..."
            apiClient.checkStatus { response ->
                runOnUiThread {
                    if (response != null) {
                        val hours = if (response.operatingHours == true) "운영시간" else "운영시간 외"
                        txtServerStatus.text = "서버 정상 ($hours)"
                        txtServerStatus.setTextColor(getColor(android.R.color.holo_green_dark))
                    } else {
                        txtServerStatus.text = "서버 연결 실패"
                        txtServerStatus.setTextColor(getColor(android.R.color.holo_red_dark))
                    }
                }
            }
        }

        btnSettings.setOnClickListener {
            showSettingsDialog()
        }
    }

    private fun refreshUI() {
        // 봇 상태
        val hasPermission = isNotificationPermissionGranted()
        val isActive = prefs.botEnabled && hasPermission && NotificationService.instance != null

        txtStatus.text = when {
            !hasPermission -> "알림 읽기 권한 필요"
            !prefs.botEnabled -> "봇 꺼짐"
            NotificationService.instance == null -> "서비스 시작 중..."
            else -> "봇 활성 중"
        }

        txtStatus.setTextColor(getColor(
            if (isActive) android.R.color.holo_green_dark else android.R.color.darker_gray
        ))

        btnCheckPermission.visibility = if (hasPermission) android.view.View.GONE else android.view.View.VISIBLE

        // 통계
        txtStats.text = "응답: ${prefs.totalResponses}건  |  에스컬레이션: ${prefs.totalEscalations}건  |  에러: ${prefs.totalErrors}건"

        // 로그
        val logs = NotificationService.getRecentLogs()
        txtLogs.text = if (logs.isEmpty()) {
            "아직 로그가 없습니다.\n카카오톡 메시지가 오면 여기에 표시됩니다."
        } else {
            logs.take(30).joinToString("\n")
        }
    }

    private fun isNotificationPermissionGranted(): Boolean {
        val listeners = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return listeners?.contains(packageName) == true
    }

    private fun checkNotificationPermission() {
        if (!isNotificationPermissionGranted()) {
            AlertDialog.Builder(this)
                .setTitle("알림 읽기 권한")
                .setMessage("카카오톡 메시지를 읽으려면 알림 접근 권한이 필요합니다.\n\n설정에서 'CS봇'을 활성화해주세요.")
                .setPositiveButton("설정으로 이동") { _, _ ->
                    startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                }
                .setNegativeButton("나중에", null)
                .show()
        }
    }

    private fun showSettingsDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_settings, null)
        val edtApiUrl = view.findViewById<EditText>(R.id.edtApiUrl)
        val edtApiKey = view.findViewById<EditText>(R.id.edtApiKey)
        val edtMinDelay = view.findViewById<EditText>(R.id.edtMinDelay)
        val edtMaxDelay = view.findViewById<EditText>(R.id.edtMaxDelay)
        val chkWeekday = view.findViewById<CheckBox>(R.id.chkWeekdayOnly)

        edtApiUrl.setText(prefs.apiUrl)
        edtApiKey.setText(prefs.apiKey)
        edtMinDelay.setText(prefs.minDelay.toString())
        edtMaxDelay.setText(prefs.maxDelay.toString())
        chkWeekday.isChecked = prefs.weekdayOnly

        AlertDialog.Builder(this)
            .setTitle("설정")
            .setView(view)
            .setPositiveButton("저장") { _, _ ->
                prefs.apiUrl = edtApiUrl.text.toString().trimEnd('/')
                prefs.apiKey = edtApiKey.text.toString()
                prefs.minDelay = edtMinDelay.text.toString().toIntOrNull() ?: 3000
                prefs.maxDelay = edtMaxDelay.text.toString().toIntOrNull() ?: 8000
                prefs.weekdayOnly = chkWeekday.isChecked
                Toast.makeText(this, "설정 저장됨", Toast.LENGTH_SHORT).show()
            }
            .setNeutralButton("통계 초기화") { _, _ ->
                prefs.resetStats()
                refreshUI()
            }
            .setNegativeButton("취소", null)
            .show()
    }
}
