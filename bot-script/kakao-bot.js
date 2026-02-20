/**
 * 카카오톡 CS 봇 - 채팅 자동응답 봇 앱용 스크립트
 *
 * 사용법:
 * 1. 안드로이드 폰에 "채팅 자동응답 봇" 앱 설치
 *    https://play.google.com/store/apps/details?id=com.darktornado.chatbot
 * 2. 이 코드를 봇 앱에 새 스크립트로 등록
 * 3. API_URL과 API_KEY를 실제 값으로 변경
 * 4. 카카오톡 알림 읽기 권한 허용
 * 5. 봇 활성화
 *
 * API2 기반 (채팅 자동응답 봇 v2.0+)
 */

// ============================================
// 설정 (반드시 변경하세요)
// ============================================
var API_URL = "http://1.234.83.118:3000";
var API_KEY = "csbot-webhook-2026!secret";

// 봇 이름 (자기 메시지 필터링용)
var BOT_NAME = "CS봇";

// 응답할 방 이름 목록 (빈 배열이면 모든 방에 응답)
var ALLOWED_ROOMS = [];

// 무시할 발신자 목록
var IGNORED_SENDERS = [BOT_NAME];

// 관리자 이름 (관리 명령어 사용 가능)
var ADMIN_NAMES = ["관리자"];

// ============================================
// 운영 설정
// ============================================
var OP_START_HOUR = 9;
var OP_START_MIN = 50;
var OP_END_HOUR = 18;
var OP_END_MIN = 30;

// 최소/최대 응답 대기시간 (ms)
var MIN_EXTRA_DELAY = 500;
var MAX_EXTRA_DELAY = 2000;

// 같은 방에 연속 응답 최소 간격 (ms)
var ROOM_COOLDOWN = 5000;

// 프로액티브 폴링 간격 (ms) - 3분
var PROACTIVE_POLL_INTERVAL = 180000;

// 차단 방 캐시 TTL (ms) - 10분
var BLOCK_CACHE_TTL = 600000;

// ============================================
// 내부 상태
// ============================================
var lastResponseTime = {};
var errorCount = 0;
var MAX_ERRORS = 5;
var blockedRooms = {};
var proactiveTimer = null;
var botEnabled = true;

// ============================================
// 유틸리티 함수
// ============================================

function isOperatingHours() {
    var now = new Date();
    var h = now.getHours();
    var m = now.getMinutes();
    var currentMin = h * 60 + m;
    var startMin = OP_START_HOUR * 60 + OP_START_MIN;
    var endMin = OP_END_HOUR * 60 + OP_END_MIN;
    return currentMin >= startMin && currentMin <= endMin;
}

function isWeekday() {
    var day = new Date().getDay();
    return day >= 1 && day <= 5;
}

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isAllowedRoom(room) {
    if (ALLOWED_ROOMS.length === 0) return true;
    for (var i = 0; i < ALLOWED_ROOMS.length; i++) {
        if (ALLOWED_ROOMS[i] === room) return true;
    }
    return false;
}

function isIgnoredSender(sender) {
    for (var i = 0; i < IGNORED_SENDERS.length; i++) {
        if (IGNORED_SENDERS[i] === sender) return true;
    }
    return false;
}

function isAdmin(sender) {
    for (var i = 0; i < ADMIN_NAMES.length; i++) {
        if (ADMIN_NAMES[i] === sender) return true;
    }
    return false;
}

function isCooldown(room) {
    var last = lastResponseTime[room] || 0;
    return (Date.now() - last) < ROOM_COOLDOWN;
}

function isRoomBlocked(room) {
    var cache = blockedRooms[room];
    if (cache && (Date.now() - cache.checkedAt) < BLOCK_CACHE_TTL) {
        return cache.blocked;
    }
    return false;
}

function shouldSkipMessage(msg) {
    if (msg.length < 2) return true;
    if (/^[ㅋㅎㅠㅜㅇ]+$/.test(msg)) return true;
    if (/^(ㅇㅇ|ㅇㅋ|ㅎㅇ|ㄴㄴ|ㄱㄱ|ㄱㅅ)$/.test(msg)) return true;
    if (msg === "사진" || msg === "동영상" || msg === "이모티콘") return true;
    return false;
}

// ============================================
// HTTP 통신
// ============================================

function callAPI(room, sender, message, isGroupChat) {
    try {
        var conn = org.jsoup.Jsoup.connect(API_URL + "/webhook/message")
            .header("Content-Type", "application/json")
            .header("X-API-Key", API_KEY)
            .requestBody(JSON.stringify({
                roomId: room,
                userName: sender,
                message: message,
                isGroupChat: isGroupChat
            }))
            .ignoreContentType(true)
            .ignoreHttpErrors(true)
            .timeout(30000)
            .method(org.jsoup.Connection.Method.POST)
            .execute();

        var statusCode = conn.statusCode();
        if (statusCode !== 200) {
            Log.d("API Error: HTTP " + statusCode);
            return null;
        }

        var data = JSON.parse(conn.body());
        return data;
    } catch (e) {
        Log.e("API call failed: " + e);
        return null;
    }
}

function checkAPIStatus() {
    try {
        var conn = org.jsoup.Jsoup.connect(API_URL + "/webhook/status")
            .header("X-API-Key", API_KEY)
            .ignoreContentType(true)
            .ignoreHttpErrors(true)
            .timeout(5000)
            .method(org.jsoup.Connection.Method.GET)
            .execute();

        return JSON.parse(conn.body());
    } catch (e) {
        return null;
    }
}

function fetchPendingProactive() {
    try {
        var conn = org.jsoup.Jsoup.connect(API_URL + "/webhook/proactive/pending?limit=5")
            .header("X-API-Key", API_KEY)
            .ignoreContentType(true)
            .ignoreHttpErrors(true)
            .timeout(10000)
            .method(org.jsoup.Connection.Method.GET)
            .execute();

        if (conn.statusCode() !== 200) return [];
        var data = JSON.parse(conn.body());
        return data.messages || [];
    } catch (e) {
        return [];
    }
}

function reportProactive(id, status, errorMsg) {
    try {
        var body = { id: id, status: status };
        if (errorMsg) body.error = errorMsg;

        org.jsoup.Jsoup.connect(API_URL + "/webhook/proactive/report")
            .header("Content-Type", "application/json")
            .header("X-API-Key", API_KEY)
            .requestBody(JSON.stringify(body))
            .ignoreContentType(true)
            .ignoreHttpErrors(true)
            .timeout(5000)
            .method(org.jsoup.Connection.Method.POST)
            .execute();
    } catch (e) {
        Log.e("[CS봇] Report failed: " + e);
    }
}

function checkBlockStatus(room) {
    try {
        var conn = org.jsoup.Jsoup.connect(API_URL + "/webhook/blocks/check?roomId=" + encodeURIComponent(room))
            .header("X-API-Key", API_KEY)
            .ignoreContentType(true)
            .ignoreHttpErrors(true)
            .timeout(5000)
            .method(org.jsoup.Connection.Method.GET)
            .execute();

        if (conn.statusCode() === 200) {
            var data = JSON.parse(conn.body());
            blockedRooms[room] = { blocked: data.blocked, checkedAt: Date.now() };
            return data.blocked;
        }
    } catch (e) {}
    return false;
}

// ============================================
// 프로액티브 메시지 폴링
// ============================================

function startProactivePolling() {
    if (proactiveTimer) return;

    proactiveTimer = new java.util.Timer();
    proactiveTimer.scheduleAtFixedRate(new java.util.TimerTask({
        run: function() {
            try {
                if (!botEnabled) return;
                if (!isOperatingHours() || !isWeekday()) return;

                var messages = fetchPendingProactive();
                if (messages.length === 0) return;

                for (var i = 0; i < messages.length; i++) {
                    var msg = messages[i];
                    try {
                        var delay = randomDelay(2000, 5000);
                        java.lang.Thread.sleep(delay);

                        // 봇 앱의 replier는 response 함수에서만 사용 가능
                        // 프로액티브 전송은 Api.replyRoom 사용
                        Api.replyRoom(msg.room_id, msg.message);

                        reportProactive(msg.id, "sent");
                        Log.d("[CS봇] 프로액티브 전송: " + msg.room_id);
                    } catch (e) {
                        reportProactive(msg.id, "failed", String(e));
                        Log.e("[CS봇] 프로액티브 실패: " + msg.room_id + " - " + e);
                    }
                }
            } catch (e) {
                Log.e("[CS봇] 프로액티브 폴링 에러: " + e);
            }
        }
    }), PROACTIVE_POLL_INTERVAL, PROACTIVE_POLL_INTERVAL);

    Log.i("[CS봇] 프로액티브 폴링 시작 (간격: " + (PROACTIVE_POLL_INTERVAL / 1000) + "초)");
}

function stopProactivePolling() {
    if (proactiveTimer) {
        proactiveTimer.cancel();
        proactiveTimer = null;
        Log.i("[CS봇] 프로액티브 폴링 중지");
    }
}

// ============================================
// 관리자 명령어
// ============================================

function handleAdminCommand(msg, sender, replier) {
    if (!isAdmin(sender)) return false;

    if (msg === "!봇상태") {
        var status = checkAPIStatus();
        var text = "[CS봇 상태]\n";
        text += "봇 활성: " + (botEnabled ? "켜짐" : "꺼짐") + "\n";
        text += "운영시간: " + (isOperatingHours() ? "운영 중" : "운영 외") + "\n";
        text += "평일: " + (isWeekday() ? "예" : "아니오") + "\n";
        text += "에러 카운트: " + errorCount + "/" + MAX_ERRORS + "\n";
        text += "프로액티브: " + (proactiveTimer ? "폴링 중" : "중지") + "\n";
        if (status) {
            text += "서버 상태: " + status.status + "\n";
            text += "서버 시간: " + status.timestamp;
        } else {
            text += "서버 상태: 연결 실패";
        }
        replier.reply(text);
        return true;
    }

    if (msg === "!봇켜기") {
        botEnabled = true;
        errorCount = 0;
        startProactivePolling();
        replier.reply("[CS봇] 봇이 활성화되었습니다.");
        return true;
    }

    if (msg === "!봇끄기") {
        botEnabled = false;
        stopProactivePolling();
        replier.reply("[CS봇] 봇이 비활성화되었습니다.");
        return true;
    }

    if (msg === "!에러초기화") {
        errorCount = 0;
        replier.reply("[CS봇] 에러 카운트가 초기화되었습니다.");
        return true;
    }

    return false;
}

// ============================================
// 메인 응답 함수
// ============================================

function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
    // 관리자 명령어 처리 (필터 무시)
    if (msg.charAt(0) === "!" && handleAdminCommand(msg, sender, replier)) return;

    // 봇 비활성화 상태
    if (!botEnabled) return;

    // 기본 필터링
    if (isIgnoredSender(sender)) return;
    if (!isAllowedRoom(room)) return;
    if (shouldSkipMessage(msg)) return;
    if (isCooldown(room)) return;

    // 운영 시간 + 평일 체크
    if (!isOperatingHours() || !isWeekday()) return;

    // 차단된 방 체크 (캐시)
    if (isRoomBlocked(room)) return;

    // 연속 에러 시 일시 중지 (5분 후 자동 복구)
    if (errorCount >= MAX_ERRORS) {
        if (!this._errorPauseStart) this._errorPauseStart = Date.now();
        if (Date.now() - this._errorPauseStart < 300000) return;
        errorCount = 0;
        this._errorPauseStart = null;
    }

    // API 호출 (별도 스레드에서 실행)
    new java.lang.Thread(new java.lang.Runnable({
        run: function() {
            try {
                // 차단 여부 서버 확인 (캐시 만료 시)
                var cache = blockedRooms[room];
                if (!cache || (Date.now() - cache.checkedAt) >= BLOCK_CACHE_TTL) {
                    if (checkBlockStatus(room)) return;
                }

                var result = callAPI(room, sender, msg, isGroupChat);

                if (!result) {
                    errorCount++;
                    return;
                }

                errorCount = 0;

                if (!result.answer) return;

                var serverDelay = result.delay || 3000;
                var extraDelay = randomDelay(MIN_EXTRA_DELAY, MAX_EXTRA_DELAY);
                var totalDelay = serverDelay + extraDelay;

                java.lang.Thread.sleep(totalDelay);

                replier.reply(result.answer);

                lastResponseTime[room] = Date.now();

                Log.d("[CS봇] " + room + " | " + sender + " → " +
                    (result.escalated ? "[에스컬레이션]" : "[응답]") +
                    " | 유사도:" + Math.round((result.confidence || 0) * 100) + "%" +
                    " | " + result.processingMs + "ms" +
                    " | 딜레이:" + totalDelay + "ms");

            } catch (e) {
                Log.e("[CS봇] Error: " + e);
                errorCount++;
            }
        }
    })).start();
}

// ============================================
// 초기화
// ============================================

startProactivePolling();

Log.i("[CS봇] 스크립트 로드 완료");
Log.i("[CS봇] API: " + API_URL);
Log.i("[CS봇] 운영시간: " + OP_START_HOUR + ":" + OP_START_MIN + " ~ " + OP_END_HOUR + ":" + OP_END_MIN);
Log.i("[CS봇] 관리 명령어: !봇상태, !봇켜기, !봇끄기, !에러초기화");
