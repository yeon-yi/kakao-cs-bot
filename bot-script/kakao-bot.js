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

// ============================================
// 운영 설정
// ============================================
var OP_START_HOUR = 9;
var OP_START_MIN = 50;
var OP_END_HOUR = 18;
var OP_END_MIN = 30;

// 최소/최대 응답 대기시간 (ms) - 서버에서도 계산하지만 클라이언트에서 추가 보정
var MIN_EXTRA_DELAY = 500;
var MAX_EXTRA_DELAY = 2000;

// 같은 방에 연속 응답 최소 간격 (ms)
var ROOM_COOLDOWN = 5000;

// ============================================
// 내부 상태
// ============================================
var lastResponseTime = {};  // 방별 마지막 응답 시간
var errorCount = 0;         // 연속 에러 횟수
var MAX_ERRORS = 5;         // 연속 에러 시 일시 중지

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

function isCooldown(room) {
    var last = lastResponseTime[room] || 0;
    return (Date.now() - last) < ROOM_COOLDOWN;
}

function shouldSkipMessage(msg) {
    // 너무 짧은 메시지 (이모지, ㅋㅋ 등)
    if (msg.length < 2) return true;
    // 단순 반응
    if (/^[ㅋㅎㅠㅜㅇ]+$/.test(msg)) return true;
    if (/^(ㅇㅇ|ㅇㅋ|ㅎㅇ|ㄴㄴ|ㄱㄱ|ㄱㅅ)$/.test(msg)) return true;
    // 사진/동영상 알림
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
            .timeout(30000)  // 30초 타임아웃 (AI 처리 시간 고려)
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

        var data = JSON.parse(conn.body());
        return data;
    } catch (e) {
        return null;
    }
}

// ============================================
// 메인 응답 함수
// ============================================

function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
    // 기본 필터링
    if (isIgnoredSender(sender)) return;
    if (!isAllowedRoom(room)) return;
    if (shouldSkipMessage(msg)) return;
    if (isCooldown(room)) return;

    // 운영 시간 + 평일 체크
    if (!isOperatingHours() || !isWeekday()) return;

    // 연속 에러 시 일시 중지 (5분 후 자동 복구)
    if (errorCount >= MAX_ERRORS) {
        if (!this._errorPauseStart) this._errorPauseStart = Date.now();
        if (Date.now() - this._errorPauseStart < 300000) return;  // 5분
        errorCount = 0;
        this._errorPauseStart = null;
    }

    // API 호출 (별도 스레드에서 실행)
    new java.lang.Thread(new java.lang.Runnable({
        run: function() {
            try {
                var result = callAPI(room, sender, msg, isGroupChat);

                if (!result) {
                    errorCount++;
                    return;
                }

                // 에러 카운트 리셋
                errorCount = 0;

                // 응답이 없는 경우 (운영시간 외, rate limit 등)
                if (!result.answer) return;

                // 서버 제안 딜레이 + 클라이언트 추가 딜레이
                var serverDelay = result.delay || 3000;
                var extraDelay = randomDelay(MIN_EXTRA_DELAY, MAX_EXTRA_DELAY);
                var totalDelay = serverDelay + extraDelay;

                // 인간다운 대기
                java.lang.Thread.sleep(totalDelay);

                // 답장
                replier.reply(result.answer);

                // 쿨다운 업데이트
                lastResponseTime[room] = Date.now();

                // 로그
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
// 관리 명령어 (관리자용)
// ============================================

// 봇 상태 확인: "!봇상태" 입력
// 위 response 함수 위에 별도 체크 추가하려면:
// if (msg === "!봇상태") { ... }

Log.i("[CS봇] 스크립트 로드 완료");
Log.i("[CS봇] API: " + API_URL);
Log.i("[CS봇] 운영시간: " + OP_START_HOUR + ":" + OP_START_MIN + " ~ " + OP_END_HOUR + ":" + OP_END_MIN);
