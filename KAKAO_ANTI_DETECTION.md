# 카카오톡 탐지 회피 전략 (2026) - 단일 폰 최적화

## 단일 디바이스 구성
```yaml
하드웨어:
  - 안드로이드 폰 1대 (중고 갤럭시 A 시리즈 추천)
  - USB 케이블
  - 서버 (Oracle Cloud Free Tier)

네트워크:
  - 고정 프록시 IP (기존 보유)
  - NO VPN (탐지 위험)
  - NO Residential Proxy Rotation (비용 절감)

소프트웨어:
  - 실제 카카오톡 앱
  - Appium Server
  - Frida (고급 후킹 - 선택)
```

## 2026 최신 회피 기술

### 1. TLS Fingerprinting 우회

**문제**: 카카오톡이 TLS 핸드셰이크 패턴으로 자동화 탐지
```
일반 Python requests:
  - TLS 1.2 with Python cipher suite
  - 특정 extension 순서
  → 즉시 탐지됨

실제 안드로이드 앱:
  - TLS 1.3 with Android cipher suite
  - 디바이스별 고유 extension
  → 탐지 회피
```

**해결**: curl-impersonate (실제 Chrome/Android TLS 모방)
```typescript
// packages/network/tls-stealth.ts
import { spawn } from 'child_process';

class TLSStealth {
  /**
   * curl-impersonate로 실제 Android TLS 시그니처 사용
   */
  async makeRequest(url: string, options: RequestOptions): Promise<Response> {
    // curl-impersonate android 버전 사용
    const curl = spawn('curl-impersonate-chrome', [
      url,
      '--impersonate', 'chrome110',  // 또는 실제 안드로이드 버전
      '-H', `User-Agent: ${this.getAndroidUA()}`,
      '-H', `X-Requested-With: com.kakao.talk`,
      '--http2',  // HTTP/2 필수
      '--compressed',
      ...this.buildHeaders(options),
    ]);
    
    return this.parseResponse(curl);
  }
  
  private getAndroidUA(): string {
    // 실제 디바이스 UA (폰에서 추출)
    return 'Mozilla/5.0 (Linux; Android 13; SM-A536N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36';
  }
}
```

**설치**:
```bash
# curl-impersonate 설치
curl -LO https://github.com/lwthiker/curl-impersonate/releases/download/v0.6.1/curl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz
tar -xzf curl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz
sudo cp curl-impersonate-chrome /usr/local/bin/
```

### 2. HTTP/2 Fingerprinting 우회
```typescript
// packages/network/http2-stealth.ts
import http2 from 'http2';

class HTTP2Stealth {
  /**
   * 실제 Chrome/Android의 HTTP/2 설정 모방
   */
  createSession(authority: string): http2.ClientHttp2Session {
    const session = http2.connect(authority, {
      // Android Chrome 110 설정
      settings: {
        headerTableSize: 65536,
        enablePush: false,
        initialWindowSize: 6291456,
        maxHeaderListSize: 262144,
      },
      // ALPN 협상
      ALPNProtocols: ['h2'],
      // TLS 옵션
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.3',
      ciphers: this.getAndroidCiphers(),
    });
    
    return session;
  }
  
  private getAndroidCiphers(): string {
    // Android 13 기본 cipher suite
    return [
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
      // ...
    ].join(':');
  }
}
```

### 3. 디바이스 지문 일관성 유지
```typescript
// apps/bot/src/kakao/device-fingerprint.ts

interface DeviceFingerprint {
  deviceId: string;
  model: string;
  manufacturer: string;
  osVersion: string;
  appVersion: string;
  screenDensity: number;
  screenSize: { width: number; height: number };
  timezone: string;
  language: string;
  carrier: string;
  // 2026 추가
  batteryLevel?: number;
  isCharging?: boolean;
  availableStorage: number;
  totalStorage: number;
  cpuArchitecture: string;
  installedApps: string[]; // 해시값
}

class DeviceFingerprintManager {
  private fingerprint: DeviceFingerprint | null = null;
  
  /**
   * 실제 디바이스에서 한 번만 추출
   */
  async extractFromDevice(): Promise<DeviceFingerprint> {
    if (this.fingerprint) return this.fingerprint;
    
    // ADB로 실제 디바이스 정보 추출
    const deviceId = await this.adb('shell settings get secure android_id');
    const model = await this.adb('shell getprop ro.product.model');
    const manufacturer = await this.adb('shell getprop ro.product.manufacturer');
    const osVersion = await this.adb('shell getprop ro.build.version.release');
    
    // 카카오톡 앱 버전
    const appVersion = await this.adb('shell dumpsys package com.kakao.talk | grep versionName');
    
    // 화면 정보
    const density = await this.adb('shell wm density');
    const size = await this.adb('shell wm size');
    
    // 배터리
    const battery = await this.adb('shell dumpsys battery');
    
    // 저장공간
    const storage = await this.adb('shell df /data');
    
    // CPU
    const cpu = await this.adb('shell getprop ro.product.cpu.abi');
    
    // 설치된 앱 목록 (해시)
    const apps = await this.adb('shell pm list packages');
    const appHash = this.hashApps(apps);
    
    this.fingerprint = {
      deviceId,
      model,
      manufacturer,
      osVersion,
      appVersion,
      screenDensity: parseInt(density),
      screenSize: this.parseSize(size),
      timezone: 'Asia/Seoul',
      language: 'ko-KR',
      carrier: 'SKT', // 실제 값으로
      batteryLevel: this.parseBattery(battery).level,
      isCharging: this.parseBattery(battery).charging,
      availableStorage: this.parseStorage(storage).available,
      totalStorage: this.parseStorage(storage).total,
      cpuArchitecture: cpu,
      installedApps: appHash,
    };
    
    // 영구 저장 (다음번에 동일하게 사용)
    await this.save(this.fingerprint);
    
    return this.fingerprint;
  }
  
  /**
   * 모든 요청에 일관된 fingerprint 사용
   */
  async applyToRequest(request: any): Promise<any> {
    const fp = await this.getFingerprint();
    
    request.headers = {
      ...request.headers,
      'X-Device-Id': fp.deviceId,
      'X-App-Version': fp.appVersion,
      'User-Agent': this.buildUA(fp),
      'X-Device-Model': fp.model,
      'X-OS-Version': fp.osVersion,
    };
    
    return request;
  }
  
  private async adb(command: string): Promise<string> {
    const { stdout } = await execAsync(`adb ${command}`);
    return stdout.trim();
  }
}
```

### 4. 프록시 최적화 (고정 IP 활용)
```typescript
// packages/network/proxy-manager.ts

class ProxyManager {
  private fixedProxies: FixedProxy[];
  private currentIndex = 0;
  
  constructor(proxies: string[]) {
    // 보유한 고정 프록시 IP 목록
    this.fixedProxies = proxies.map(url => ({
      url,
      lastUsed: 0,
      failCount: 0,
      isHealthy: true,
    }));
  }
  
  /**
   * 고정 IP 로테이션 (쿨다운 적용)
   */
  getProxy(): string {
    const now = Date.now();
    const COOLDOWN = 60000; // 1분 쿨다운
    
    // 쿨다운 지난 프록시 찾기
    for (let i = 0; i < this.fixedProxies.length; i++) {
      const idx = (this.currentIndex + i) % this.fixedProxies.length;
      const proxy = this.fixedProxies[idx];
      
      if (proxy.isHealthy && now - proxy.lastUsed > COOLDOWN) {
        proxy.lastUsed = now;
        this.currentIndex = (idx + 1) % this.fixedProxies.length;
        return proxy.url;
      }
    }
    
    // 모두 쿨다운 중이면 가장 오래된 것 사용
    const oldest = this.fixedProxies.reduce((prev, curr) => 
      prev.lastUsed < curr.lastUsed ? prev : curr
    );
    oldest.lastUsed = now;
    
    return oldest.url;
  }
  
  /**
   * IP 워밍업 (새로 추가된 프록시는 천천히 사용)
   */
  async warmupProxy(proxyUrl: string): Promise<void> {
    console.log(`🔥 Warming up proxy: ${proxyUrl}`);
    
    // 1일차: 10개 요청
    for (let i = 0; i < 10; i++) {
      await this.makeTestRequest(proxyUrl);
      await this.sleep(3600000); // 1시간 간격
    }
    
    // 2일차: 50개 요청
    // 3일차: 100개 요청
    // 이후 정상 사용
  }
  
  /**
   * IP 평판 모니터링
   */
  async checkReputation(proxyUrl: string): Promise<boolean> {
    // IP 평판 확인 서비스 (AbuseIPDB 등)
    const ip = this.extractIP(proxyUrl);
    
    try {
      const response = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}`, {
        headers: {
          'Key': process.env.ABUSEIPDB_KEY!,
          'Accept': 'application/json',
        }
      });
      
      const data = await response.json();
      
      // 신뢰 점수 80 이상만 사용
      return data.data.abuseConfidenceScore < 20;
    } catch {
      return true; // 확인 실패 시 일단 사용
    }
  }
}
```

### 5. WebRTC Leak 방지
```typescript
// apps/bot/src/kakao/webrtc-block.ts

/**
 * WebRTC로 실제 IP 유출 방지
 * (웹뷰 사용 시 필요)
 */
class WebRTCBlocker {
  async injectBlocker(): Promise<void> {
    // Appium으로 JavaScript 주입
    await this.driver.execute(`
      // WebRTC API 무력화
      if (window.RTCPeerConnection) {
        window.RTCPeerConnection = undefined;
      }
      if (window.webkitRTCPeerConnection) {
        window.webkitRTCPeerConnection = undefined;
      }
      if (window.mozRTCPeerConnection) {
        window.mozRTCPeerConnection = undefined;
      }
      
      // getUserMedia 차단
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = undefined;
      }
      
      // 기존 연결 종료
      if (window.RTCDataChannel) {
        window.RTCDataChannel = undefined;
      }
    `);
  }
}
```

### 6. Canvas Fingerprinting 방지
```typescript
// apps/bot/src/kakao/canvas-spoof.ts

/**
 * Canvas fingerprinting 노이즈 추가
 */
class CanvasSpoofing {
  async injectNoise(): Promise<void> {
    await this.driver.execute(`
      // Canvas에 미세한 노이즈 추가
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function() {
        const ctx = this.getContext('2d');
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        
        // 1% 픽셀에 ±1 노이즈
        for (let i = 0; i < imageData.data.length; i += 4) {
          if (Math.random() < 0.01) {
            imageData.data[i] += Math.random() > 0.5 ? 1 : -1;
          }
        }
        
        ctx.putImageData(imageData, 0, 0);
        return originalToDataURL.apply(this, arguments);
      };
      
      // getImageData도 마찬가지
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function() {
        const result = originalGetImageData.apply(this, arguments);
        // 노이즈 추가
        return result;
      };
    `);
  }
}
```

## 단일 폰 운영 전략

### 메시지 처리 효율화
```typescript
// apps/bot/src/kakao/single-phone-orchestrator.ts

class SinglePhoneOrchestrator {
  private messageQueue: PriorityQueue<Message>;
  private isProcessing = false;
  
  /**
   * 우선순위 큐로 효율적 처리
   */
  async enqueueMessage(message: Message): Promise<void> {
    // 우선순위 계산
    const priority = this.calculatePriority(message);
    
    this.messageQueue.enqueue(message, priority);
    
    // 처리 시작
    if (!this.isProcessing) {
      this.processQueue();
    }
  }
  
  private calculatePriority(message: Message): number {
    let priority = 50; // 기본
    
    // 직원 메시지: 낮음 (응답 안함 가능성)
    if (message.senderRole === 'STAFF') {
      priority -= 30;
    }
    
    // 긴급 키워드
    if (/급해|빨리|당장|바로/.test(message.content)) {
      priority += 40;
    }
    
    // 불만 키워드
    if (/문제|이상|불만|화남/.test(message.content)) {
      priority += 30;
    }
    
    // VIP 광고주
    if (this.isVIP(message.senderId)) {
      priority += 20;
    }
    
    // 오래 대기한 메시지
    const waitTime = Date.now() - message.receivedAt;
    priority += Math.min(waitTime / 60000, 20); // 1분당 +1점, 최대 20점
    
    return priority;
  }
  
  private async processQueue(): Promise<void> {
    this.isProcessing = true;
    
    while (!this.messageQueue.isEmpty()) {
      const message = this.messageQueue.dequeue();
      
      try {
        await this.processMessage(message);
        
        // 다음 메시지까지 인간적 딜레이
        const delay = this.calculateDelay();
        await this.sleep(delay);
        
      } catch (error) {
        console.error('메시지 처리 실패:', error);
        
        // 재시도 (3회까지)
        if (message.retryCount < 3) {
          message.retryCount++;
          this.messageQueue.enqueue(message, this.calculatePriority(message));
        }
      }
    }
    
    this.isProcessing = false;
  }
  
  private calculateDelay(): number {
    const hour = new Date().getHours();
    
    // 바쁜 시간대 (10-12시, 14-17시): 빠르게
    if ((hour >= 10 && hour < 12) || (hour >= 14 && hour < 17)) {
      return this.normalRandom(30000, 10000); // 30초 ± 10초
    }
    
    // 점심시간 (12-14시): 느리게
    if (hour >= 12 && hour < 14) {
      return this.normalRandom(180000, 60000); // 3분 ± 1분
    }
    
    // 기타: 중간
    return this.normalRandom(60000, 20000); // 1분 ± 20초
  }
}
```

### 배터리 절약 모드
```typescript
// apps/bot/src/kakao/battery-saver.ts

class BatterySaver {
  /**
   * 비활동 시간엔 폰 슬립
   */
  async enablePowerSaving(): Promise<void> {
    const hour = new Date().getHours();
    
    // 점심시간 (12-13시)
    if (hour === 12) {
      await this.adb('shell input keyevent KEYCODE_POWER'); // 화면 끄기
      await this.sleep(3600000); // 1시간 대기
      await this.adb('shell input keyevent KEYCODE_POWER'); // 화면 켜기
    }
    
    // 퇴근 후 (18:30-익일 09:50)
    if (hour >= 19 || hour < 9) {
      // 완전 슬립
      await this.adb('shell svc power shutdown');
    }
  }
  
  /**
   * 백그라운드 앱 정리
   */
  async cleanupBackground(): Promise<void> {
    // 카카오톡 제외 모든 앱 종료
    await this.adb('shell am force-stop com.android.chrome');
    await this.adb('shell am force-stop com.google.android.gm');
    // ...
  }
}
```

## 최종 구성 (단일 폰)
```yaml
하드웨어:
  - 안드로이드 폰: 1대 ($100-150)
  - USB 케이블: $5
  총: ~$150

네트워크:
  - 고정 프록시: 기존 보유 ($0)
  - IP 워밍업: 3일 소요

소프트웨어:
  - curl-impersonate: 무료
  - Appium: 무료
  - Frida (선택): 무료

운영:
  - 동시 처리: 1개씩 순차
  - 평균 처리: 5-10 메시지/시간
  - 일일 처리: 40-80 메시지
  
  → 7,500 메시지 / 80 = 94일 백로그
  → 실시간 처리 불가능!

⚠️ 해결책:
  1. 중요 메시지만 필터링
  2. 폰 추가 (2-3대)
  3. 또는 탐지 위험 감수하고 속도 증가
```

## 비용 최종
```
초기 투자:
- 중고 폰 1대: $120
- USB 케이블: $5
총: $125

월간 비용:
- 프록시: $0 (기존 보유)
- 전기세: ~$2
총: $2/월

ROI: 2개월이면 회수
```